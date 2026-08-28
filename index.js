const http = require('http');
const net = require('net');

const PORT = process.env.SERVER_PORT || process.env.PORT || 25679;
const INTERNAL_PORT = 8080;

// 全局防崩溃捕获
process.on('uncaughtException', (err) => console.error('[uncaughtException]:', err.message));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]:', reason));

// 1. HTTP 基础响应
const server = http.createServer((req, res) => {
  console.log(`[HTTP Request] ${req.method} ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Bot Runtime Active</h1>');
});

// 2. WebSocket 流量转发
server.on('upgrade', (req, socket, head) => {
  console.log(`[WS Upgrade] Path: ${req.url}`);
  if (req.url === '/vless-ws' || req.url.startsWith('/vless-ws')) {
    const targetSocket = net.connect(INTERNAL_PORT, '127.0.0.1', () => {
      targetSocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        targetSocket.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
      }
      targetSocket.write('\r\n');
      if (head && head.length) targetSocket.write(head);

      socket.pipe(targetSocket);
      targetSocket.pipe(socket);
    });

    targetSocket.on('error', (err) => {
      console.error('[Sing-box Connection Error]:', err.message);
      socket.destroy();
    });
    socket.on('error', () => targetSocket.destroy());
  } else {
    socket.destroy();
  }
});

// 3. 不传 host 参数，使 Node.js 自动绑定所有接口 (Dual-Stack)
server.listen(PORT, () => {
  console.log(`[Engine] Node server successfully bound to port ${PORT} (Dual-Stack)`);
});
