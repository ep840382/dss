const http = require('http');
const net = require('net');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => console.error('[Error]', err.message));
process.on('unhandledRejection', (reason) => console.error('[Error]', reason));

const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const INTERNAL_PORT = 8080;
const DOMAIN = 'fi3.bot-hosting.net';

// 1. 动态读取 config.json 中的 UUID
let UUID = '0febdf96-c364-4a8a-af2b-7707e102e31a';
const configPath = path.join(__dirname, 'config.json');

try {
  if (fs.existsSync(configPath)) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (configData.inbounds?.[0]?.users?.[0]?.uuid) {
      UUID = configData.inbounds[0].users[0].uuid;
    }
  } else {
    const defaultConfig = {
      log: { level: "info" },
      inbounds: [{
        type: "vless",
        tag: "vless-in",
        listen: "127.0.0.1",
        listen_port: INTERNAL_PORT,
        users: [{ uuid: UUID }],
        transport: { type: "ws", path: "/vless-ws" }
      }],
      outbounds: [{ type: "direct", tag: "direct" }]
    };
    fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2));
  }
} catch (e) {
  console.error('[Config Error]', e.message);
}

// 2. 清理后台残留进程
try {
  execSync('pkill -f web || true');
  execSync('pkill -f npm-runner || true');
} catch (e) {}

// 3. HTTP 与 WebSocket 升级转发
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end('<h1>Server Active</h1>');
});

server.on('upgrade', (req, socket, head) => {
  if (req.url && (req.url === '/vless-ws' || req.url.startsWith('/vless-ws'))) {
    const targetSocket = net.connect(INTERNAL_PORT, '127.0.0.1', () => {
      targetSocket.write(
        `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n` +
        Object.keys(req.headers).map(k => `${k}: ${req.headers[k]}`).join('\r\n') +
        '\r\n\r\n'
      );
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
  console.log(`[Engine] HTTP Proxy listening on port: ${PORT}`);
});

// 4. 解密并拉取运行组件
const decode = (str) => Buffer.from(str, 'base64').toString('utf-8');
const URL_CORE = decode('aHR0cHM6Ly9naXRodWIuY29tL1NhZ2VyTmV0L3NpbmctYm94L3JlbGVhc2VzL2Rvd25sb2FkL3YxLjkuMy9zaW5nLWJveC0xLjkuMy1saW51eC1hbWQ2NC50YXIuZ3o=');
const URL_TUNNEL = decode('aHR0cHM6Ly9naXRodWIuY29tL2Nsb3VkZmxhcmUvY2xvdWRmbGFyZWQvcmVsZWFzZXMvbGF0ZXN0L2Rvd25sb2FkL2Nsb3VkZmxhcmVkLWxpbnV4LWFtZDY0');

const BIN_CORE = path.join(__dirname, 'web');
const BIN_TUNNEL = path.join(__dirname, 'npm-runner');
const ua = 'npm/9.6.7 node/v18.16.0 linux x64';

if (!fs.existsSync(BIN_CORE)) {
  try {
    console.log('[Core] Downloading Sing-box core...');
    execSync(`curl -A "${ua}" -sSL "${URL_CORE}" | tar -xz -C /tmp && mv /tmp/sing-box-*/sing-box ${BIN_CORE} && chmod +x ${BIN_CORE}`);
  } catch (e) { console.error('[Core Download Failed]:', e.message); }
}

if (!fs.existsSync(BIN_TUNNEL)) {
  try {
    console.log('[Tunnel] Downloading cloudflared...');
    execSync(`curl -A "${ua}" -sSL -o ${BIN_TUNNEL} "${URL_TUNNEL}" && chmod +x ${BIN_TUNNEL}`);
  } catch (e) { console.error('[Tunnel Download Failed]:', e.message); }
}

// 5. 运行 Sing-box
if (fs.existsSync(BIN_CORE)) {
  const runCore = () => {
    console.log('[Core] Launching Sing-box backend...');
    const sb = spawn(BIN_CORE, ['run', '-c', 'config.json']);
    sb.stdout.on('data', data => console.log(`[Sing-box] ${data.toString().trim()}`));
    sb.stderr.on('data', data => console.log(`[Sing-box] ${data.toString().trim()}`));
    sb.on('exit', () => setTimeout(runCore, 3000));
  };
  runCore();
}

// 6. 运行 Cloudflare 隧道并输出同步后的节点
if (fs.existsSync(BIN_TUNNEL)) {
  const runTunnel = () => {
    console.log('[Tunnel] Starting Cloudflare Tunnel...');
    const cf = spawn(BIN_TUNNEL, ['tunnel', '--url', `http://127.0.0.1:${INTERNAL_PORT}`]);
    let printed = false;
    cf.stderr.on('data', data => {
      const match = data.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !printed) {
        printed = true;
        const sub = match[0].replace('https://', '');
        console.log('\n==================================================');
        console.log(`[UUID Sync] 当前已生效 UUID: ${UUID}`);
        console.log('🚀【CF 隧道加密节点链接】:');
        console.log(`vless://${UUID}@${sub}:443?encryption=none&security=tls&sni=${sub}&type=ws&host=${sub}&path=%2Fvless-ws#CF-Tunnel`);
        console.log('\n⚡【原生直连节点链接】:');
        console.log(`vless://${UUID}@${DOMAIN}:${PORT}?encryption=none&security=none&type=ws&host=${DOMAIN}&path=%2Fvless-ws#Native-Direct`);
        console.log('==================================================\n');
      }
    });
    cf.on('exit', () => setTimeout(runTunnel, 5000));
  };
  runTunnel();
}

setInterval(() => {}, 100000);
