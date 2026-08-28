const http = require('http');
const net = require('net');
const { spawn, execSync } = require('child_process');
const fs = require('fs');

const PORT = process.env.SERVER_PORT || process.env.PORT || 25679;
const INTERNAL_PORT = 8080;
const UUID = '0febdf96-c364-4a8a-af2b-7707e102e31a';
const DOMAIN = 'fi3.bot-hosting.net';

// 全局异常防崩溃捕获
process.on('uncaughtException', (err) => console.error('[uncaughtException]:', err.message));
process.on('unhandledRejection', (reason) => console.error('[unhandledRejection]:', reason));

// 1. 自动写入 Sing-box 核心配置文件 config.json
function generateConfig() {
  const configContent = {
    log: { level: "info" },
    inbounds: [
      {
        type: "vless",
        tag: "vless-in",
        listen: "127.0.0.1",
        listen_port: INTERNAL_PORT,
        users: [{ uuid: UUID }],
        transport: { type: "ws", path: "/vless-ws" }
      }
    ],
    outbounds: [{ type: "direct", tag: "direct" }]
  };
  fs.writeFileSync('./config.json', JSON.stringify(configContent, null, 2));
  console.log('[Config] 已自动生成 config.json');
}

// 2. 检查并拉起 Sing-box 后端内核
function startCore() {
  generateConfig();
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
  core.stderr.on('data', (data) => console.log(`[Sing-box] ${data.toString().trim()}`));
  core.on('close', (code) => {
    console.warn(`[Sing-box 退出] 代码: ${code}，3秒后自动重启...`);
    setTimeout(startCore, 3000);
  });
}

// 3. 检查并拉起 Cloudflare 自动化隧道
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

  let hasPrinted = false;
  tunnel.stderr.on('data', (data) => {
    const str = data.toString();
    const match = str.match(/https:\/\/[-a-z0-9]+\.trycloudflare\.com/);
    if (match && !hasPrinted) {
      hasPrinted = true;
      const tunnelDomain = match[0].replace('https://', '');

      const cfTunnelLink = `vless://${UUID}@${tunnelDomain}:443?encryption=none&security=tls&sni=${tunnelDomain}&type=ws&host=${tunnelDomain}&path=%2Fvless-ws#CF-Tunnel`;
      const nativeLink = `vless://${UUID}@${DOMAIN}:${PORT}?encryption=none&security=none&type=ws&host=${DOMAIN}&path=%2Fvless-ws#Native-Direct`;

      console.log('==================================================');
      console.log('🚀【CF 隧道加速节点链接】：');
      console.log(cfTunnelLink);
      console.log('⚡【原生直连节点链接】：');
      console.log(nativeLink);
      console.log('==================================================');
    }
  });

  tunnel.on('close', () => {
    hasPrinted = false;
    setTimeout(startTunnel, 3000);
  });
}

// 4. HTTP 与 WebSocket 代理转发入口
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>VLESS Service Active</h1>');
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

// 5. 启动 HTTP 监听
server.listen(PORT, () => {
  console.log(`[Engine] 本地服务启动成功，监听端口: ${PORT}`);
  startCore();
  startTunnel();
});
