const http = require('http');
const net = require('net');
const { spawn, execSync } = require('child_process');
const fs = require('fs');

const PORT = process.env.SERVER_PORT || process.env.PORT || 25679;
const INTERNAL_PORT = 8080;
const UUID = '0febdf96-c364-4a8a-af2b-7707e102e31a';

// 1. 自动下载并启动 Sing-box 核心
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

  core.stderr.on('data', (data) => console.log(`[Sing-box] ${data.toString().trim()}`));
  core.on('close', () => setTimeout(startCore, 3000));
}

// 2. 自动下载并拉起 Cloudflare 自动化隧道 (无需 Worker/账号)
function startTunnel() {
  if (!fs.existsSync('./cloudflared')) {
    console.log('[Tunnel] 正在下载 Cloudflare 隧道组件...');
    try {
      execSync('curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared');
      console.log('[Tunnel] 组件下载成功');
    } catch (e) {
      console.error('[Tunnel 下载失败]:', e.message);
      return;
    }
  }

  console.log('[Tunnel] 正在建立免费加密传输隧道...');
  const tunnel = spawn('./cloudflared', ['tunnel', '--url', `http://127.0.0.1:${PORT}`]);

  tunnel.stderr.on('data', (data) => {
    const str = data.toString();
    const match = str.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/);
    if (match) {
      const tunnelDomain = match[0].replace('https://', '');
      const vlessLink = `vless://${UUID}@${tunnelDomain}:443?encryption=none&security=tls&sni=${tunnelDomain}&type=ws&host=${tunnelDomain}&path=%2Fvless-ws#Direct-Tunnel`;

      console.log('\n==================================================');
      console.log('⚡【可用节点链接（已成功绕过端口拦截）】：');
      console.log(vlessLink);
      console.log('==================================================\n');
    }
  });

  tunnel.on('close', () => setTimeout(startTunnel, 3000));
}

// 3. HTTP 及 WebSocket 流量入口
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Service Online</h1>');
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

    targetSocket.on('error', () => socket.destroy());
    socket.on('error', () => targetSocket.destroy());
  } else {
    socket.destroy();
  }
});

server.listen(PORT, () => {
  console.log(`[Engine] 本地服务运行在端口: ${PORT}`);
  startCore();
  startTunnel();
});
