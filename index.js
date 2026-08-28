const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

process.on('uncaughtException', (err) => console.error('[Error]', err.message));
process.on('unhandledRejection', (reason) => console.error('[Error]', reason));

// 1. 动态自动获取分配端口
const PORT = parseInt(process.env.SERVER_PORT || process.env.PORT || 3000);
const configPath = path.join(__dirname, 'config.json');

// 2. 动态自动精准获取公网 IP / 域名 (严格过滤 0.0.0.0 及内网保留地址)
let DOMAIN = '';

const fetchPublicIP = () => {
  const apis = [
    'curl -sSL --max-time 3 https://api.ipify.org',
    'curl -sSL --max-time 3 https://ifconfig.me',
    'curl -sSL --max-time 3 https://icanhazip.com',
    'curl -sSL --max-time 3 https://api.ip.sb/ip'
  ];
  for (const cmd of apis) {
    try {
      const ip = execSync(cmd, { encoding: 'utf8' }).trim();
      // 匹配合法公网 IPv4，且排除 0.0.0.0 与 127.x.x.x
      if (ip && /^(\d{1,3}\.){3}\d{1,3}$/.test(ip) && !ip.startsWith('0.') && !ip.startsWith('127.')) {
        return ip;
      }
    } catch (e) {}
  }
  return null;
};

DOMAIN = fetchPublicIP();

// 如果 API 抓取受限，自动从系统环境变量或主机名推断真实节点域名
if (!DOMAIN) {
  const envIp = process.env.SERVER_IP;
  if (envIp && envIp !== '0.0.0.0' && envIp !== '127.0.0.1') {
    DOMAIN = envIp;
  } else {
    const hostname = os.hostname();
    DOMAIN = hostname ? `${hostname}.bot-hosting.cloud` : '127.0.0.1';
  }
}

// 3. 清理残留进程
try {
  execSync('pkill -f web || true');
  execSync('pkill -f npm-runner || true');
} catch (e) {}

// 4. 动态读取 config.json 中的 UUID
let UUID = '0febdf96-c364-4a8a-af2b-7707e102e31a';

try {
  if (fs.existsSync(configPath)) {
    const configData = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    if (configData.inbounds?.[0]?.users?.[0]?.uuid) {
      UUID = configData.inbounds[0].users[0].uuid;
    }
  }
} catch (e) {
  console.error('[Config Read Error]', e.message);
}

// 自动写入配置文件 (Sing-box 本地监听 0.0.0.0 以接收流量)
const finalConfig = {
  log: { level: "info" },
  inbounds: [{
    type: "vless",
    tag: "vless-in",
    listen: "0.0.0.0",
    listen_port: PORT,
    users: [{ uuid: UUID }],
    transport: { type: "ws", path: "/vless-ws" }
  }],
  outbounds: [{ type: "direct", tag: "direct" }]
};

fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2));

// 5. 自动解密并拉取二进制组件
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

// 6. 启动 Sing-box
if (fs.existsSync(BIN_CORE)) {
  const runCore = () => {
    console.log(`[Core] Launching Sing-box on port ${PORT}...`);
    const sb = spawn(BIN_CORE, ['run', '-c', 'config.json']);
    sb.stdout.on('data', data => console.log(`[Sing-box] ${data.toString().trim()}`));
    sb.stderr.on('data', data => console.log(`[Sing-box] ${data.toString().trim()}`));
    sb.on('exit', () => setTimeout(runCore, 3000));
  };
  runCore();
}

// 7. 启动 Cloudflare 隧道并输出准确的节点地址
if (fs.existsSync(BIN_TUNNEL)) {
  const runTunnel = () => {
    console.log('[Tunnel] Starting Cloudflare Tunnel...');
    const cf = spawn(BIN_TUNNEL, ['tunnel', '--url', `http://127.0.0.1:${PORT}`]);
    let printed = false;
    cf.stderr.on('data', data => {
      const match = data.toString().match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/);
      if (match && !printed) {
        printed = true;
        const sub = match[0].replace('https://', '');
        console.log('\n==================================================');
        console.log(`[Auto-Detect] 自动精准抓取外网地址: ${DOMAIN}:${PORT}`);
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
