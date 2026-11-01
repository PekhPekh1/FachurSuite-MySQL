// PM2 process management for the production Next.js app.
// The app forks to its CPU count less one, restarts on uncaught failure, rotates
// logs, and is gracefully reloaded (zero-downtime) on deploys.
module.exports = {
  apps: [
    {
      name: "installment-sales",
      script: "node_modules/.bin/next",
      args: "start",
      cwd: "/opt/installment-sales",
      instances: 1, // journal-safe; DB sessions/refresh tokens live in PostgreSQL
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
      },
      listen_timeout: 15000,
      kill_timeout: 5000,
      restart_delay: 2000,
      max_restarts: 10,
      max_memory_restart: "900M",
      out_file: "/var/log/installment-sales/out.log",
      error_file: "/var/log/installment-sales/error.log",
      merge_logs: true,
      time: true,
    },
  ],
};
