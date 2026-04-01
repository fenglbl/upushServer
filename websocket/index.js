const WebSocket = require('ws')
const { URL } = require('url')

/**
 * WebSocketServerManager
 *
 * 作用：
 * 1. 复用已有的 HTTP server 处理 WebSocket upgrade
 * 2. 按 clientId 管理客户端连接（一个 id 可对应多个连接）
 * 3. 支持按指定 id 推送消息，或全量广播
 * 4. 通过心跳清理失活连接
 */
class WebSocketServerManager {
  constructor(server) {
    // clientsMap: clientId => Set<WebSocket>
    // 用来存储某个用户 / 设备 id 对应的所有连接
    this.clientsMap = new Map()

    // noServer 模式：不单独监听端口，而是复用外部 HTTP server
    this.wss = new WebSocket.Server({ noServer: true })

    // 当升级成功后，统一走 onConnection 做连接登记
    this.wss.on('connection', (ws, req, clientId) => {
      this.onConnection(ws, req, clientId)
    })

    // 监听 HTTP upgrade 事件，把 /ws/:id 路径升级为 WebSocket 连接
    server.on('upgrade', (req, socket, head) => {
      try {
        const url = new URL(req.url, 'http://localhost')

        // 只处理 /ws/:id 这类路径，其他 upgrade 请求直接拒绝
        if (!url.pathname.startsWith('/ws/')) {
          socket.destroy()
          return
        }

        // 从路径中截取 clientId，例如 /ws/user-1 => user-1
        const clientId = decodeURIComponent(url.pathname.slice(4)).trim()
        if (!clientId) {
          socket.destroy()
          return
        }

        // 把当前请求升级成 WebSocket，并把 clientId 传给 connection 回调
        this.wss.handleUpgrade(req, socket, head, (ws) => {
          this.wss.emit('connection', ws, req, clientId)
        })
      } catch (error) {
        // URL 解析异常或其他升级异常时，直接断开 socket
        socket.destroy()
      }
    })

    // 启动心跳，定期检测并清理失活连接
    this.startHeartbeat()
  }

  /**
   * 新连接接入后的统一处理
   */
  onConnection(ws, req, clientId) {
    // 记录连接归属的 clientId，并标记当前连接存活
    ws._clientId = clientId
    ws.isAlive = true

    // 一个 clientId 可能同时有多个端在线，因此用 Set 存储
    if (!this.clientsMap.has(clientId)) {
      this.clientsMap.set(clientId, new Set())
    }
    this.clientsMap.get(clientId).add(ws)

    console.log(`[ws] client connected: ${clientId}`)

    // 收到 pong 说明连接仍然活着，用于心跳检测
    ws.on('pong', () => {
      ws.isAlive = true
    })

    // 当前先简单打印客户端消息，后续如需双向通信可继续扩展
    ws.on('message', (message) => {
      console.log(`[ws] message from ${clientId}: ${message}`)
    })

    // 断开连接时，从 clientsMap 中移除
    ws.on('close', () => {
      this.removeClient(clientId, ws)
      console.log(`[ws] client disconnected: ${clientId}`)
    })

    // 打印连接级错误，便于后续排查
    ws.on('error', (error) => {
      console.error(`[ws] error from ${clientId}:`, error.message)
    })
  }

  /**
   * 从指定 clientId 的连接集合中移除某个连接
   */
  removeClient(clientId, ws) {
    if (!this.clientsMap.has(clientId)) return
    const set = this.clientsMap.get(clientId)
    set.delete(ws)

    // 如果某个 clientId 已经没有任何在线连接，则删除该键
    if (set.size === 0) {
      this.clientsMap.delete(clientId)
    }
  }

  /**
   * 广播消息
   *
   * @param {string} message 要发送的字符串消息
   * @param {string|null} clientId 传入时只给指定 clientId 推送；不传则全量广播
   */
  broadcast(message, clientId = null) {
    if (clientId) {
      const set = this.clientsMap.get(String(clientId))
      if (!set) return

      set.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(message)
        }
      })
      return
    }

    // 不指定 clientId 时，给当前所有在线连接广播
    this.wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    })
  }

  /**
   * 心跳检测：
   * - 先把连接标记为未存活，并发送 ping
   * - 若下个周期前没收到 pong，就认为连接失活并终止
   */
  startHeartbeat(interval = 30000) {
    this.heartbeatTimer = setInterval(() => {
      this.wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
          ws.terminate()
          return
        }

        ws.isAlive = false
        ws.ping()
      })
    }, interval)
  }

  /**
   * 关闭 WebSocket 服务
   */
  close() {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
    }

    this.wss.clients.forEach((ws) => ws.close())
    this.wss.close()
  }
}

module.exports = WebSocketServerManager
