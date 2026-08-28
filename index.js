const http = require('http');
const net = require('net');
const fs = require('fs');
const path = require('path');

// 优先监听内部 PORT，若无则监听 SERVER_PORT 或 3000
const PORT = 3000;
const INTERNAL_PORT = 9090;

// 全局防崩溃捕获
process.on('uncaughtException', (err) => console.error('[全局未捕获异常]:', err));
process.on('unhandledRejection', (reason) => console.error('[全局未处理拒绝]:', reason));

// 1. 创建 HTTP 服务，响应根路径健康检查
const server = http.createServer((req, res) => {
  console.log(`[HTTP 请求入站] Path: ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Bot Runtime Active</h1>');
});

// 2. WebSocket 升级处理
server.on('upgrade', (req, socket, head) => {
  console.log(`[WS 请求入站] Path: ${req.url}`);
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
      console.error('[转发至Sing-box失败]:', err.message);
      socket.destroy();
    });
    socket.on('error', () => targetSocket.destroy());
  } else {
    socket.destroy();
  }
});

// 3. 监听端口
server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Engine] Successfully listening on 0.0.0.0:${PORT}`);
  console.log(`[环境变量查看] PORT=${process.env.PORT}, SERVER_PORT=${process.env.SERVER_PORT}`);
});
