# 书安 macOS DMG Build

## 完整打包流程

```bash
cd apps/safeclaw

# 1. 构建 Tauri app bundle
pnpm tauri build --bundles app

# 2. 修复 libkrun dylib 的 install name（必须）
#    - 将主程序的 libkrun 引用从 homebrew 路径改为 @executable_path/../Resources/box/lib/libkrun.1.dylib
#    - 将所有 dylib 的内部 install name 从 @executable_path/box/lib/ 改为 @executable_path/../Resources/box/lib/
#    - 重新签名所有二进制文件
node scripts/fix-macos-bundle.mjs

# 3. 验证 box 资源
node scripts/verify-box-resources.mjs --dir src-tauri/target/release/bundle/macos/书安.app/Contents/Resources

# 4. 创建 DMG（包含 Applications 符号链接）
STAGING_DIR=$(mktemp -d)
cp -R src-tauri/target/release/bundle/macos/书安.app "$STAGING_DIR/"
ln -sf /Applications "$STAGING_DIR/Applications"
hdiutil create \
  -volname "书安" \
  -srcfolder "$STAGING_DIR" \
  -ov \
  -format UDZO \
  src-tauri/target/release/bundle/dmg/书安_0.2.0_aarch64.dmg
rm -rf "$STAGING_DIR"

# 5. 验证 DMG 内容
hdiutil verify src-tauri/target/release/bundle/dmg/书安_0.2.0_aarch64.dmg
```

## 一键打包脚本

```bash
# 需要设置签名密钥（可选，用于更新器）
export SAFECLAW_TAURI_KEY_PASSWORD="your-password"
./scripts/build-macos-dmg.sh
```

## 手动打包关键点

### 1. fix-macos-bundle.mjs 做了什么

- 用 `install_name_tool -change` 将主程序中 libkrun 的引用路径改为 `@executable_path/../Resources/box/lib/libkrun.1.dylib`
- 用 `install_name_tool -id` 修改所有 dylib 的内部 install name 为正确路径
- 用 `codesign --deep` 重新签名整个 app bundle

### 2. DMG 必须包含 Applications 符号链接

用户打开 DMG 后需要能直接拖动到 Applications。创建时：

```bash
STAGING_DIR=$(mktemp -d)
cp -R 书安.app "$STAGING_DIR/"
ln -sf /Applications "$STAGING_DIR/Applications"  # 关键！
hdiutil create -srcfolder "$STAGING_DIR" ...
```

### 3. libkrun 问题说明

书安 依赖 libkrun 用于 TEE。打包时必须：
- 链接到 app bundle 内的 dylib（`Contents/Resources/box/lib/`）
- 不能链接到 homebrew 安装的路径（`/opt/homebrew/*/libkrun*.dylib`）

## 输出文件

- App bundle: `src-tauri/target/release/bundle/macos/书安.app`
- Updater 存档: `src-tauri/target/release/bundle/macos/书安.app.tar.gz`
- DMG: `src-tauri/target/release/bundle/dmg/书安_<version>.dmg`

## 签名密钥

默认从以下位置读取：
- `~/.tauri/safeclaw-updater.key`
- `~/.tauri/safeclaw-updater.key.pub`
- `~/.tauri/safeclaw-updater.key.password`

可覆盖：
```bash
export SAFECLAW_TAURI_KEY_PATH=/path/to/key
export SAFECLAW_TAURI_PUBKEY_PATH=/path/to/pubkey
export SAFECLAW_TAURI_KEY_PASSWORD="password"
```
