import { createServer } from 'http'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { WebSocketServer, type WebSocket } from 'ws'
import { manager } from './instance-manager.js'
import { createApiRouter } from './routes/api.js'

const __dirname = dirname(fileURLToPath(import.meta.url))

const PORT = parseInt(process.env.PORT || '3000', 10)
const app = express()

// JSON body parsing
app.use(express.json())

// API routes
app.use('/api', createApiRouter(manager))

// Serve static frontend
app.use(express.static(join(__dirname, 'public')))

// Fallback to index.html for SPA (only for non-API routes)
app.get(/^(?!\/api\/).*/, (_req, res) => {
	res.sendFile(join(__dirname, 'public', 'index.html'))
})

// HTTP server (shared by Express + WebSocket)
const server = createServer(app)

// WebSocket for real-time updates
const wss = new WebSocketServer({ server, path: '/ws' })

// Track connected clients
const clients = new Set<WebSocket>()

wss.on('connection', (ws) => {
	clients.add(ws)

	ws.on('close', () => {
		clients.delete(ws)
	})

	ws.on('error', () => {
		clients.delete(ws)
	})
})

// Wire up the manager broadcast to WebSocket clients
manager.setBroadcast((event: string, data: unknown) => {
	const payload = JSON.stringify({ event, data })
	for (const client of clients) {
		if (client.readyState === client.OPEN) {
			client.send(payload)
		}
	}
})

server.listen(PORT, () => {
	console.log(`Baileys Web Panel running at http://localhost:${PORT}`)
	console.log(`Instances directory: ${process.env.INSTANCES_DIR || join(process.cwd(), 'data', 'instances')}`)
})
