const net = require('net');
const { spawn, execSync } = require('child_process');
const fs = require('fs');

const PORT = process.env.SERVER_PORT || process.env.PORT || 25679;
const INTERNAL_PORT = 8080;
const UUID = '0febdf96-c364-4a8a-af2b-7707e102e31a';
const DOMAIN = 'fi3.bot-hosting.net';

process.on('uncaughtException', (err) => console.error('[Error]:', err.message));
process.on('unhandledRejection', (reason) => console.error('[Rejection]:', reason));

// 1. 自动写入标准 Sing-box 配置
function generateConfig() {
  const configContent = {
    log: { level: "info" },
    inbounds: [
      {
        type: "vless",
        tag: "vless-in",
        listen: "0.0.0.0",
        listen_port: INTERNAL_PORT,
        users: [{ uuid: UUID }],
        transport: { type: "ws", path: "/vless-ws" }
      }
    ],
    outbounds: [{ type: "direct", tag: "direct" }]
  };
  fs.writeFileSync('./config.json', JSON.stringify(configContent, null, 2));
}

// 2. 检查并启动 Sing-box
function startCore() {
  generateConfig();
  if (!fs.existsSync('./web')) {
    console.log('[Core] 下载 Sing-box 核心...');
    try {
      execSync('curl -sL https://github.com/SagerNet/sing-box/releases/download/v1.8.10/sing-box-1.8.10-linux-amd64.tar.gz | tar -xz --strip-components=1 && mv sing-box web && chmod +x web');
    } catch (e) {
      console.error('[Core 下载失败]:', e.message);
    }
  }

  console.log('[Core] 拉起 Sing-box 进程...');
  const core = spawn('./web', ['run', '-c', 'config.json']);
  core.stdout.on('data', (data) => console.log(`[Sing-box] ${data.toString().trim()}`));
  core.stderr.on('data', (data) => console.log(`[Sing-box] ${data.toString().trim()}`));
  core.on('close', () => setTimeout(startCore, 3000));
}

// 3. 启动 Cloudflare 隧道 (直连 Sing-box 8080 端口)
function startTunnel() {
  if (!fs.existsSync('./cloudflared')) {
    console.log('[Tunnel] 下载 cloudflared...');
    try {
      execSync('curl -sL https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64 -o cloudflared && chmod +x cloudflared');
    } catch (e) {
      console.error('[Tunnel 下载失败]:', e.message);
      return;
    }
  }

  console.log('[Tunnel] 建立 Cloudflare 加密隧道...');
  const tunnel = spawn('./cloudflared', ['tunnel', '--url', `http://127.0.0.1:${INTERNAL_PORT}`]);

  let printed = false;
  tunnel.stderr.on('data', (data) => {
    const match = data.toString().match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/);
    if (match && !printed) {
      printed = true;
      const sub = match[0].replace('https://', '');
      console.log('==================================================');
      console.log('🚀【CF 隧道加速节点链接】：');
      console.log(`vless://${UUID}@${sub}:443?encryption=none&security=tls&sni=${sub}&type=ws&host=${sub}&path=%2Fvless-ws#CF-Tunnel`);
      console.log('⚡【原生直连节点链接】：');
      console.log(`vless://${UUID}@${DOMAIN}:${PORT}?encryption=none&security=none&type=ws&host=${DOMAIN}&path=%2Fvless-ws#Native-Direct`);
      console.log('==================================================');
    }
  });

  tunnel.on('close', () => {
    printed = false;
    setTimeout(startTunnel, 3000);
  });
}

// 4. TCP 纯透明转发 (不解析/不破坏 WS 握手标头)
const server = net.createServer((clientSocket) => {
  const targetSocket = net.connect(INTERNAL_PORT, '127.0.0.1', () => {
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });

  clientSocket.on('error', () => targetSocket.destroy());
  targetSocket.on('error', () => clientSocket.destroy());
});

server.listen(PORT, () => {
  console.log(`[Engine] TCP 透明代理转发监听端口: ${PORT}`);
  startCore();
  startTunnel();
});
