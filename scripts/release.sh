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
npm install --production=false

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
rm -rf "$RELEASE_DIR/server/__tests__" "$RELEASE_DIR/server/services/schedule-helpers.js"
cp -r scripts "$RELEASE_DIR/"
cp package.json package-lock.json "$RELEASE_DIR/"
cp .env.example "$RELEASE_DIR/.env" 2>/dev/null || cp .env "$RELEASE_DIR/.env"
cp README.md "$RELEASE_DIR/"

# Create start script
cat > "$RELEASE_DIR/start.sh" << 'EOF'
#!/bin/bash
echo "Starting 课表管理系统..."
echo "首次启动请设置 ALLOW_REGISTRATION=true 以注册第一个账号"
echo ""

# Install production dependencies if needed
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies..."
  npm install --production
fi

# Start server
ALLOW_REGISTRATION=${ALLOW_REGISTRATION:-false} node server/index.js
EOF
chmod +x "$RELEASE_DIR/start.sh"

# Create .env.example
cat > "$RELEASE_DIR/.env.example" << 'EOF'
PORT=8080
JWT_SECRET=change-me-to-a-random-string
ALLOW_REGISTRATION=true
DB_PATH=./data/data.db
EOF

# Create systemd service file
cat > "$RELEASE_DIR/curriculum-scheduler.service" << EOF
[Unit]
Description=课表管理系统
After=network.target

[Service]
Type=simple
WorkingDirectory=$(pwd)/$RELEASE_DIR
ExecStart=$(which node) server/index.js
Restart=on-failure
Environment=PORT=8080
Environment=JWT_SECRET=change-me
Environment=ALLOW_REGISTRATION=false
Environment=DB_PATH=./data/data.db

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
echo "  sudo cp curriculum-scheduler.service /etc/systemd/system/"
echo "  sudo systemctl enable curriculum-scheduler"
echo "  sudo systemctl start curriculum-scheduler"
