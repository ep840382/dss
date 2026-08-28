const http = require('http');
const net = require('net');
const { spawn, execSync } = require('child_process');
const fs = require('fs');

const PORT = process.env.SERVER_PORT || process.env.PORT || 25679;
const INTERNAL_PORT = 8080;

// 1. 检查并自动拉起后台 Sing-box 内核
function startCore() {
  if (!fs.existsSync('./web')) {
    console.log('[Core] 正在下载 Sing-box 核心文件...');
    try {
      execSync('curl -sL https://github.com/SagerNet/sing-box/releases/download/v1.8.10/sing-box-1.8.10-linux-amd64.tar.gz | tar -xz --strip-components=1 && mv sing-box web && chmod +x web');
      console.log('[Core] 下载并安装成功');
    } catch (e) {
      console.error('[Core 下载失败]:', e.message);
    }
  }

  console.log('[Core] 正在拉起 Sing-box 进程...');
  const core = spawn('./web', ['run', '-c', 'config.json']);
  
  core.stdout.on('data', (data) => console.log(`[Sing-box] ${data.toString().trim()}`));
  core.stderr.on('data', (data) => console.error(`[Sing-box 错误] ${data.toString().trim()}`));
  core.on('close', (code) => {
    console.warn(`[Sing-box 进程退出] 退出码: ${code}，3秒后自动重启...`);
    setTimeout(startCore, 3000);
  });
}

startCore();

// 2. HTTP 与 WebSocket 流量转发入口
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Native Node Active</h1>');
});

server.on('upgrade', (req, socket, head) => {
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
      console.error('[转发 8080 失败, Sing-box 未就绪]:', err.message);
      socket.destroy();
    });
    socket.on('error', () => targetSocket.destroy());
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[Engine] 原生中转节点启动完成，监听端口: ${PORT}`);
});
