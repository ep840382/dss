const http = require('http');

// 必须恢复监听 SERVER_PORT (25679)
const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;

process.on('uncaughtException', (err) => console.error('[捕获异常]:', err));
process.on('unhandledRejection', (reason) => console.error('[捕获拒绝]:', reason));

const server = http.createServer((req, res) => {
  console.log(`[HTTP 访问成功] Path: ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Bot Runtime Active</h1>');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[Engine] 纯净测试节点正常运行在端口: ${PORT}`);
});
