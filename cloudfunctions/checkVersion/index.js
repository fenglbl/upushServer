'use strict';

const uniCloud = require('../../db/index.js')

function compareVersion(current, latest) {
  const currentParts = String(current || '0.0.0').split('.').map((item) => Number(item) || 0)
  const latestParts = String(latest || '0.0.0').split('.').map((item) => Number(item) || 0)
  const length = Math.max(currentParts.length, latestParts.length)

  for (let i = 0; i < length; i++) {
    const currentValue = currentParts[i] || 0
    const latestValue = latestParts[i] || 0
    if (currentValue < latestValue) return -1
    if (currentValue > latestValue) return 1
  }

  return 0
}

exports.main = async (event) => {
  const db = uniCloud.database()
  const versionDB = db.collection('app_version')
  const platform = event.platform || 'app'
  const currentVersion = event.versionName || '0.0.1'

  const versions = await versionDB.find({
    platform,
    status: 1
  }).sort({
    create_date: -1
  }).limit(1).toArray()

  if (!versions.length) {
    return {
      code: 200,
      msg: '当前已是最新版本',
      data: {
        hasUpdate: false,
        currentVersion,
        latestVersion: currentVersion,
        forceUpdate: false,
        platform,
        notes: '',
        downloadUrl: ''
      }
    }
  }

  const latest = versions[0]
  const compareResult = compareVersion(currentVersion, latest.version_name)
  const hasUpdate = compareResult < 0

  return {
    code: 200,
    msg: hasUpdate ? '发现新版本' : '当前已是最新版本',
    data: {
      hasUpdate,
      currentVersion,
      latestVersion: latest.version_name,
      latestVersionCode: latest.version_code,
      forceUpdate: !!latest.force_update,
      platform,
      notes: latest.notes || '',
      downloadUrl: latest.download_url || ''
    }
  }
}
