module.exports = {
  apps: [{
    name: 'whatsapp-bot',
    script: 'server.js',
    cwd: '/root/bot2027',
    env: {
      NODE_ENV: 'production',
      PORT: 3050
    },
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    error_file: '/root/.pm2/logs/whatsapp-bot-error.log',
    out_file: '/root/.pm2/logs/whatsapp-bot-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};
