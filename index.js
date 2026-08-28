const http = require('http');
const net = require('net');
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

process.on('uncaughtException', (err) => console.error('[Warning]', err.message));
process.on('unhandledRejection', (reason) => console.error('[Warning]', reason));

const PORT = process.env.SERVER_PORT || process.env.PORT || 3000;
const INTERNAL_PORT = 8080;
const UUID = '9798afef-b100-4bc0-808b-91491f85a913';

// 1. 自动检测并写入标准的 config.json 配置文件
function ensureConfig() {
  const configPath = path.join(__dirname, 'config.json');
  if (!fs.existsSync(configPath)) {
    const configData = {
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
    fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));
    console.log('[Config] 自动生成 config.json 成功');
  }
}

// 2. TCP 纯透明转发（替代原有的 HTTP Header 拼接，防止报文损坏）
const server = net.createServer((clientSocket) => {
  const targetSocket = net.connect(INTERNAL_PORT, '127.0.0.1', () => {
    clientSocket.pipe(targetSocket);
    targetSocket.pipe(clientSocket);
  });
  clientSocket.on('error', () => targetSocket.destroy());
  targetSocket.on('error', () => clientSocket.destroy());
});

server.listen(PORT, () => {
  console.log(`[Engine] Transparent TCP proxy listening on port: ${PORT}`);
});

// 3. 解密 Base64 下载运行资源
const decode = (str) => Buffer.from(str, 'base64').toString('utf-8');
const URL_CORE = decode('aHR0cHM6Ly9naXRodWIuY29tL1NhZ2VyTmV0L3NpbmctYm94L3JlbGVhc2VzL2Rvd25sb2FkL3YxLjkuMy9zaW5nLWJveC0xLjkuMy1saW51eC1hbWQ2NC50YXIuZ3o=');
const URL_TUNNEL = decode('aHR0cHM6Ly9naXRodWIuY29tL2Nsb3VkZmxhcmUvY2xvdWRmbGFyZWQvcmVsZWFzZXMvbGF0ZXN0L2Rvd25sb2FkL2Nsb3VkZmxhcmVkLWxpbnV4LWFtZDY0');

const BIN_CORE = path.join(__dirname, 'web');
const BIN_TUNNEL = path.join(__dirname, 'npm-runner');

function prepareBinaries() {
  const ua = 'npm/9.6.7 node/v18.16.0 linux x64';
  if (!fs.existsSync(BIN_CORE)) {
    try {
      execSync(`curl -A "${ua}" -sSL "${URL_CORE}" | tar -xz -C /tmp && mv /tmp/sing-box-*/sing-box ${BIN_CORE} && chmod +x ${BIN_CORE}`);
    } catch (e) { console.error('[Download Core Failed]:', e.message); }
  }
  if (!fs.existsSync(BIN_TUNNEL)) {
    try {
      execSync(`curl -A "${ua}" -sSL -o ${BIN_TUNNEL} "${URL_TUNNEL}" && chmod +x ${BIN_TUNNEL}`);
    } catch (e) { console.error('[Download Tunnel Failed]:', e.message); }
  }
}

try {
  ensureConfig();
  prepareBinaries();

  // 4. 拉起 Sing-box 后端（打印输出以便排查错误）
  if (fs.existsSync(BIN_CORE)) {
    const runCore = () => {
      const sb = spawn(BIN_CORE, ['run', '-c', 'config.json']);
      sb.on('exit', () => setTimeout(runCore, 3000));
      sb.stdout.on('data', data => console.log(`[Sing-box] ${data.toString().trim()}`));
      sb.stderr.on('data', data => console.log(`[Sing-box] ${data.toString().trim()}`));
    };
    runCore();
  }

  // 5. 拉起 Cloudflare 加密隧道
  if (fs.existsSync(BIN_TUNNEL)) {
    const runTunnel = () => {
      const cf = spawn(BIN_TUNNEL, ['tunnel', '--url', `http://127.0.0.1:${INTERNAL_PORT}`]);
      cf.on('exit', () => setTimeout(runTunnel, 5000));
      
      let printed = false;
      cf.stderr.on('data', data => {
        const match = data.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
        if (match && !printed) {
          printed = true;
          const currentCfDomain = match[0].replace('https://', '');
          const cfVlessLink = `vless://${UUID}@${currentCfDomain}:443?encryption=none&security=tls&sni=${currentCfDomain}&type=ws&host=${currentCfDomain}&path=%2Fvless-ws#CF-Tunnel`;
          const nativeLink = `vless://${UUID}@fi3.bot-hosting.net:${PORT}?encryption=none&security=none&type=ws&path=%2Fvless-ws#Native-Direct`;

          console.log('\n==================================================');
          console.log('🚀【CF 隧道加速节点链接】:');
          console.log(cfVlessLink);
          console.log('\n⚡【原生直连节点链接】:');
          console.log(nativeLink);
          console.log('==================================================\n');
        }
      });
    };
    runTunnel();
  }
} catch (err) {
  console.error('[Error]', err.message);
}

setInterval(() => {}, 100000);
