const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const INTERNAL_PORT = 8080;

// 1. 提供常规 HTTP 响应，防止外层网关判定 503
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Bot Runtime Active</h1>');
});

// 2. 完美还原 WebSocket 握手头并转发给本地内核
server.on('upgrade', (req, socket, head) => {
  if (req.url === '/vless-ws' || req.url.startsWith('/vless-ws')) {
    const targetSocket = net.connect(INTERNAL_PORT, '127.0.0.1', () => {
      // 还原被 Node.js 提取的原始 HTTP 握手请求头
      targetSocket.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        targetSocket.write(`${req.rawHeaders[i]}: ${req.rawHeaders[i + 1]}\r\n`);
      }
      targetSocket.write('\r\n');
      if (head && head.length) targetSocket.write(head);

      socket.pipe(targetSocket);
      targetSocket.pipe(socket);
    });

    targetSocket.on('error', () => socket.destroy());
    socket.on('error', () => targetSocket.destroy());
  } else {
    socket.destroy();
  }
});

// 3. 必须显式绑定 0.0.0.0 供公网访问
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Engine] Successfully listening on 0.0.0.0:${PORT}`);
});
