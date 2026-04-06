const fs = require('fs')
const path = require('path')

const sourceDir = path.resolve(__dirname, '../../upush-admin/dist')
const targetDir = path.resolve(__dirname, '../public/admin')

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
}

function clearDir(dir) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      fs.rmSync(fullPath, { recursive: true, force: true })
    } else {
      fs.unlinkSync(fullPath)
    }
  }
}

function copyDir(src, dest) {
  ensureDir(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name)
    const destPath = path.join(dest, entry.name)
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath)
    } else {
      fs.copyFileSync(srcPath, destPath)
    }
  }
}

if (!fs.existsSync(sourceDir)) {
  console.error(`[deploy-admin] dist not found: ${sourceDir}`)
  process.exit(1)
}

ensureDir(targetDir)
clearDir(targetDir)
copyDir(sourceDir, targetDir)

console.log(`[deploy-admin] copied admin dist to ${targetDir}`)
