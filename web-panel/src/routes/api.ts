import { Router } from 'express'
import QRCode from 'qrcode'
import { type InstanceManager } from '../instance-manager.js'

export function createApiRouter(manager: InstanceManager): Router {
	const router = Router()

	// List all instances
	router.get('/instances', async (_req, res) => {
		try {
			const instances = await manager.listInstances()
			res.json(instances)
		} catch (err) {
			res.status(500).json({ error: String(err) })
		}
	})

	// Get single instance
	router.get('/instances/:id', (req, res) => {
		const info = manager.getInstance(req.params.id)
		if (!info) {
			res.status(404).json({ error: 'Instance not found' })
			return
		}
		res.json(info)
	})

	// Get QR code for an instance
	router.get('/instances/:id/qr', (req, res) => {
		const info = manager.getInstance(req.params.id)
		if (!info) {
			res.status(404).json({ error: 'Instance not found' })
			return
		}
		res.json({ qr: info.qr, pairingCode: info.pairingCode })
	})

	// Connect an instance
	router.post('/instances/:id/connect', async (req, res) => {
		try {
			const { phoneNumber } = req.body ?? {}
			const info = await manager.connect(req.params.id, { phoneNumber })
			res.json(info)
		} catch (err) {
			res.status(500).json({ error: String(err) })
		}
	})

	// Disconnect an instance
	router.post('/instances/:id/disconnect', async (req, res) => {
		try {
			const info = await manager.disconnect(req.params.id)
			res.json(info)
		} catch (err) {
			res.status(500).json({ error: String(err) })
		}
	})

	// Get QR code image for an instance (PNG)
	router.get('/instances/:id/qr-image', async (req, res) => {
		const info = manager.getInstance(req.params.id)
		if (!info?.qr) {
			res.status(404).json({ error: 'No QR code available' })
			return
		}
		try {
			const png = await QRCode.toBuffer(info.qr, { scale: 5, margin: 1 })
			res.setHeader('Content-Type', 'image/png')
			res.send(png)
		} catch (err) {
			res.status(500).json({ error: String(err) })
		}
	})

	// Delete an instance
	router.delete('/instances/:id', async (req, res) => {
		try {
			await manager.delete(req.params.id)
			res.json({ success: true })
		} catch (err) {
			res.status(500).json({ error: String(err) })
		}
	})

	return router
}
