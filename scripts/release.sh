#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=== 课表管理系统 构建打包 ==="
echo ""

# Clean
echo "[1/4] 清理旧构建..."
rm -rf dist

# Install dependencies
echo "[2/4] 安装依赖..."
npm ci

# Build frontend
echo "[3/4] 构建前端..."
npm run build

# Create release package
echo "[4/4] 打包..."
VERSION=$(node -e "import fs from 'fs'; console.log(JSON.parse(fs.readFileSync('./package.json','utf8')).version)")
RELEASE_DIR="release/curriculum-scheduler-v${VERSION}"
rm -rf release
mkdir -p "$RELEASE_DIR"

# Copy files
cp -r dist "$RELEASE_DIR/"
cp -r server "$RELEASE_DIR/"
rm -rf "$RELEASE_DIR/server/__tests__"
cp -r scripts "$RELEASE_DIR/"
cp package.json package-lock.json "$RELEASE_DIR/"
# Ship the template as the starting .env. The old fallback copied the
# developer's real .env — live JWT_SECRET and AMAP_KEY — straight into the
# distributed tarball whenever the template was missing. Fail loudly instead.
if [ ! -f .env.example ]; then
  echo "ERROR: .env.example is missing; refusing to build a release." >&2
  exit 1
fi
cp .env.example "$RELEASE_DIR/.env"
cp README.md "$RELEASE_DIR/"

# Create start script
cat > "$RELEASE_DIR/start.sh" << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"

echo "Starting 课表管理系统..."
echo "首次启动请设置 ALLOW_REGISTRATION=true 以注册第一个账号"
echo ""

# Install production dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm ci --omit=dev
fi

# Start server. Configuration is loaded from .env by server/index.js.
node server/index.js
EOF
chmod +x "$RELEASE_DIR/start.sh"

cp .env.example "$RELEASE_DIR/.env.example"

# Create systemd service file
cat > "$RELEASE_DIR/curriculum-scheduler.service" << EOF
[Unit]
Description=课表管理系统
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/curriculum-scheduler
EnvironmentFile=/opt/curriculum-scheduler/.env
ExecStart=/usr/bin/env node /opt/curriculum-scheduler/server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

# Create tarball
cd release
tar -czf "curriculum-scheduler-v${VERSION}.tar.gz" "curriculum-scheduler-v${VERSION}"
cd ..

echo ""
echo "=== 构建完成 ==="
echo "发布包: release/curriculum-scheduler-v${VERSION}.tar.gz"
echo ""
echo "部署方式:"
echo "  1. 解压到目标服务器"
echo "  2. 编辑 .env 文件（修改 JWT_SECRET）"
echo "  3. 运行 ./start.sh"
echo ""
echo "或使用 systemd:"
echo "  sudo mkdir -p /opt/curriculum-scheduler"
echo "  sudo cp -r curriculum-scheduler-v${VERSION}/. /opt/curriculum-scheduler/"
echo "  sudo vim /opt/curriculum-scheduler/.env"
echo "  sudo npm ci --omit=dev --prefix /opt/curriculum-scheduler"
echo "  sudo cp /opt/curriculum-scheduler/curriculum-scheduler.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable curriculum-scheduler"
echo "  sudo systemctl start curriculum-scheduler"
