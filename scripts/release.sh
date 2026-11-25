#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$PROJECT_DIR"

echo "=== 课表管理系统 构建打包 ==="
echo ""

# Package the template under its own name so extracting an upgrade preserves .env.
if [ ! -f .env.example ]; then
  echo "ERROR: .env.example is missing; refusing to build a release." >&2
  exit 1
fi

# Clean
echo "[1/4] 清理旧构建..."
rm -rf dist

# Install dependencies
echo "[2/4] 安装依赖..."
npm ci --include=dev

# Build frontend
echo "[3/4] 构建前端..."
npm run build

# Create release package
echo "[4/4] 打包..."
VERSION=$(node -e "import fs from 'fs'; console.log(JSON.parse(fs.readFileSync('./package.json','utf8')).version)")
PACKAGE="curriculum-scheduler-v${VERSION}"
mkdir -p release
STAGING_DIR=$(mktemp -d release/.build-XXXXXX)
trap 'rm -rf "$STAGING_DIR"' EXIT
RELEASE_DIR="$STAGING_DIR/$PACKAGE"
mkdir -p "$RELEASE_DIR"

# Copy files
cp -r dist "$RELEASE_DIR/"
cp -r server "$RELEASE_DIR/"
rm -rf "$RELEASE_DIR/server/__tests__"
cp -r scripts "$RELEASE_DIR/"
cp -r deploy "$RELEASE_DIR/"
cp package.json package-lock.json "$RELEASE_DIR/"
cp .env.example "$RELEASE_DIR/.env.example"
cp README.md "$RELEASE_DIR/"

# Create start script
cat > "$RELEASE_DIR/start.sh" << 'EOF'
#!/bin/bash
set -e
umask 077
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

# Create systemd service file
cat > "$RELEASE_DIR/curriculum-scheduler.service" << EOF
[Unit]
Description=课表管理系统
After=network.target

[Service]
Type=simple
# Without User=/Group= systemd runs this as root — including the Puppeteer
# Chromium the image endpoints spawn. The deploy steps below create the
# account and hand it the install directory (the server writes data/ and the
# pre-restore snapshots next to the database, so it needs to own them).
User=curriculum
Group=curriculum
UMask=0077
WorkingDirectory=/opt/curriculum-scheduler
EnvironmentFile=/opt/curriculum-scheduler/.env
ExecStart=/usr/bin/env node /opt/curriculum-scheduler/server/index.js
Restart=on-failure

[Install]
WantedBy=multi-user.target
EOF

# Create tarball
tar -czf "$STAGING_DIR/$PACKAGE.tar.gz" -C "$STAGING_DIR" "$PACKAGE"
mv -f "$STAGING_DIR/$PACKAGE.tar.gz" "release/$PACKAGE.tar.gz"
rm -rf "release/$PACKAGE"
mv "$RELEASE_DIR" "release/$PACKAGE"

echo ""
echo "=== 构建完成 ==="
echo "发布包: release/curriculum-scheduler-v${VERSION}.tar.gz"
echo ""
echo "部署方式:"
echo "  1. 解压到目标服务器"
echo "  2. 首次安装执行 install -m 600 .env.example .env，再编辑 JWT_SECRET"
echo "  3. 运行 ./start.sh"
echo ""
echo "或使用 systemd:"
echo "  sudo useradd --system --no-create-home --shell /usr/sbin/nologin curriculum"
echo "  sudo mkdir -p /opt/curriculum-scheduler"
echo "  sudo tar -xzf release/$PACKAGE.tar.gz --strip-components=1 -C /opt/curriculum-scheduler/"
echo "  sudo test -e /opt/curriculum-scheduler/.env || sudo install -m 600 /opt/curriculum-scheduler/{.env.example,.env}"
echo "  sudo vim /opt/curriculum-scheduler/.env"
echo "  sudo npm ci --omit=dev --prefix /opt/curriculum-scheduler"
echo "  sudo chown -R curriculum:curriculum /opt/curriculum-scheduler"
echo "  sudo cp /opt/curriculum-scheduler/curriculum-scheduler.service /etc/systemd/system/"
echo "  sudo systemctl daemon-reload"
echo "  sudo systemctl enable curriculum-scheduler"
echo "  sudo systemctl start curriculum-scheduler"
