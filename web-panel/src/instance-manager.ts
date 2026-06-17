import { readdir, rm, stat } from 'fs/promises'
import { join } from 'path'
import makeWASocket, {
	useMultiFileAuthState,
	fetchLatestBaileysVersion,
	makeCacheableSignalKeyStore,
	DisconnectReason,
	type WASocket
} from 'baileys'
import NodeCache from '@cacheable/node-cache'
import type { Boom } from '@hapi/boom'
import pino from 'pino'
// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type InstanceStatus = 'disconnected' | 'connecting' | 'open' | 'close'

export interface InstanceInfo {
	id: string
	status: InstanceStatus
	qr: string | null
	pairingCode: string | null
	error: string | null
}

export interface InstanceInternal {
	info: InstanceInfo
	sock: WASocket | null
	logger: pino.Logger
	saveCreds: (() => Promise<void>) | null
	reconnectTimer: ReturnType<typeof setTimeout> | null
}

type BroadcastFn = (event: string, data: unknown) => void

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

const INSTANCES_DIR = process.env.INSTANCES_DIR || join(process.cwd(), 'data', 'instances')

export class InstanceManager {
	private instances = new Map<string, InstanceInternal>()
	private broadcast: BroadcastFn = () => {}

	setBroadcast(fn: BroadcastFn): void {
		this.broadcast = fn
	}

	/** Reject instance IDs that are not pure digits (prevent path traversal) */
	private validateId(id: string): void {
		if (!/^[0-9]+$/.test(id)) {
			throw new Error(`Invalid instance ID: "${id}". Must contain only digits.`)
		}
	}

	/** Scan disk for existing auth folders and populate instance list */
	async listInstances(): Promise<InstanceInfo[]> {
		const dirs: string[] = []
		try {
			const entries = await readdir(INSTANCES_DIR)
			for (const entry of entries) {
				const full = join(INSTANCES_DIR, entry)
				const s = await stat(full).catch(() => null)
				if (s?.isDirectory()) {
					dirs.push(entry)
				}
			}
		} catch {
			// directory doesn't exist yet — no instances
		}

		for (const dir of dirs) {
			if (!this.instances.has(dir)) {
				this.instances.set(dir, this.buildSlot(dir, 'disconnected'))
			}
		}

		// also include in-memory instances that may not have a folder yet
		for (const id of this.instances.keys()) {
			if (!dirs.includes(id)) {
				dirs.push(id)
			}
		}

		return dirs.map(id => this.instances.get(id)!.info)
	}

	/** Get a single instance's info */
	getInstance(id: string): InstanceInfo | undefined {
		this.validateId(id)
		return this.instances.get(id)?.info
	}

	/** Start a connection for the given instance */
	async connect(id: string, opts?: { phoneNumber?: string }): Promise<InstanceInfo> {
		this.validateId(id)
		const existing = this.instances.get(id)
		// If already connecting or open, return current info
		if (existing && (existing.info.status === 'connecting' || existing.info.status === 'open')) {
			return existing.info
		}

		const slot = existing ?? this.buildSlot(id, 'connecting')
		slot.info.status = 'connecting'
		slot.info.error = null
		slot.info.qr = null
		slot.info.pairingCode = null
		this.instances.set(id, slot)
		this.emit(id)

		this.startSocket(id, slot, opts?.phoneNumber).catch(err => {
			slot.logger.error({ err }, 'connect failed')
			slot.info.status = 'close'
			slot.info.error = String(err?.message ?? err)
			this.emit(id)
		})

		return slot.info
	}

	/** Disconnect (logout) an instance -- tells WhatsApp to invalidate the session */
	async disconnect(id: string): Promise<InstanceInfo> {
		this.validateId(id)
		const slot = this.instances.get(id)
		if (!slot) throw new Error(`Instance "${id}" not found`)

		// Clear any pending reconnect timer
		if (slot.reconnectTimer) {
			clearTimeout(slot.reconnectTimer)
			slot.reconnectTimer = null
		}

		// Save creds before tearing down the socket
		try { await slot.saveCreds?.() } catch {}

		if (slot.sock) {
			const oldSock = slot.sock
			slot.sock = null  // null first so the close handler ignores this socket

			try { await oldSock.logout() } catch { /* ok if already disconnected */ }

			try { oldSock.end(new Error('User initiated disconnect')) } catch { /* ok */ }
		}

		slot.info.status = 'disconnected'
		slot.info.qr = null
		slot.info.pairingCode = null
		slot.info.error = null
		slot.saveCreds = null
		this.emit(id)
		return slot.info
	}

	/** Delete an instance entirely -- disconnect + remove auth folder */
	async delete(id: string): Promise<void> {
		this.validateId(id)
		await this.disconnect(id)

		const dir = join(INSTANCES_DIR, id)
		await rm(dir, { recursive: true, force: true })

		this.instances.delete(id)
		this.broadcast('instance-deleted', { id })
	}

	// -----------------------------------------------------------------------
	// Internal
	// -----------------------------------------------------------------------

	private buildSlot(id: string, status: InstanceStatus): InstanceInternal {
		return {
			info: { id, status, qr: null, pairingCode: null, error: null },
			sock: null,
			logger: pino({ level: 'silent' }),
			saveCreds: null,
			reconnectTimer: null
		}
	}

	private emit(id: string): void {
		const info = this.instances.get(id)?.info
		if (info) {
			this.broadcast('status-update', info)
		}
	}

	private async startSocket(
		id: string,
		slot: InstanceInternal,
		phoneNumber?: string
	): Promise<void> {
		const authDir = join(INSTANCES_DIR, id)
		const { state, saveCreds } = await useMultiFileAuthState(authDir)
		slot.saveCreds = saveCreds

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const logger = pino({
			level: 'info',
			transport: {
				targets: [
					{
						target: 'pino/file',
						options: { destination: join(authDir, 'wa-logs.txt') },
						level: 'info'
					},
					{
						target: 'pino-pretty',
						options: { colorize: false },
						level: 'info'
					}
				]
			}
		}) as any

		slot.logger = logger

		const { version } = await fetchLatestBaileysVersion()
		logger.info({ version: version.join('.'), instance: id }, 'starting socket')

		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const msgRetryCounterCache = new NodeCache() as any

		const sock = makeWASocket({
			version,
			logger,
			auth: {
				creds: state.creds,
				keys: makeCacheableSignalKeyStore(state.keys, logger)
			},
			msgRetryCounterCache,
			generateHighQualityLinkPreview: true,
			getMessage: async () => undefined
		})

		slot.sock = sock

		// Listen for connection state changes
		sock.ev.on('connection.update', (update) => {
			const { connection, lastDisconnect, qr, isNewLogin } = update

			if (qr) {
				slot.info.qr = qr
				slot.info.pairingCode = null
				slot.info.status = 'connecting'
				this.broadcast('qr-update', { id, qr })
				this.emit(id)

				// If phone number provided, request pairing code
				if (phoneNumber && !sock.authState.creds.registered) {
					sock.requestPairingCode(phoneNumber)
						.then(code => {
							slot.info.pairingCode = code
							slot.logger.info({ code }, 'pairing code generated')
							this.broadcast('pairing-code', { id, code })
							this.emit(id)
						})
						.catch(err => {
							slot.logger.error({ err }, 'failed to request pairing code')
						})
				}
			}

			if (isNewLogin) {
				slot.info.qr = null
				slot.info.pairingCode = null
			}

			if (connection === 'open') {
				slot.info.status = 'open'
				slot.info.qr = null
				slot.info.pairingCode = null
				slot.info.error = null
				this.emit(id)
			}

			if (connection === 'connecting') {
				slot.info.status = 'connecting'
				this.emit(id)
			}

			if (connection === 'close') {
				// Guard: ignore close events from sockets that have been replaced
				// (e.g. user clicked Disconnect, which nulls slot.sock)
				if (slot.sock !== sock) {
					return
				}

				const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode
				const shouldReconnect =
					statusCode !== DisconnectReason.loggedOut &&
					statusCode !== DisconnectReason.forbidden

				if (shouldReconnect) {
					slot.info.status = 'connecting'
					slot.info.qr = null
					slot.info.pairingCode = null
					this.emit(id)

					// Clear any previous reconnect timer
					if (slot.reconnectTimer) {
						clearTimeout(slot.reconnectTimer)
					}

					// If auto-reconnect doesn't happen within 15s, mark as disconnected
					slot.reconnectTimer = setTimeout(() => {
						slot.reconnectTimer = null
						// Re-check both status and sock reference before declaring dead
						if (slot.info.status === 'connecting' && slot.sock === sock) {
							slot.info.status = 'disconnected'
							slot.info.error = lastDisconnect?.error
								? String((lastDisconnect.error as Error).message)
								: 'Connection closed'
							this.emit(id)
						}
					}, 15_000)
				} else {
					slot.info.status = 'disconnected'
					slot.info.error = lastDisconnect?.error
						? String((lastDisconnect.error as Error).message)
						: 'Logged out'
					slot.info.qr = null
					slot.info.pairingCode = null

					if (slot.reconnectTimer) {
						clearTimeout(slot.reconnectTimer)
						slot.reconnectTimer = null
					}
					this.emit(id)
				}
			}
		})

		// Auto-save credentials on update
		sock.ev.on('creds.update', async () => {
			await saveCreds()
		})
	}
}

// Singleton
export const manager = new InstanceManager()
