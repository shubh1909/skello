module.exports = {
  apps: [
    {
      name: "skelo",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000",
      cwd: "./",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      // Next executes pending after() callbacks during a graceful shutdown and
      // its self-hosting guide asks for a 10-30s drain window. pm2's default is
      // 1600ms, which SIGKILLs mid-callback: a webhook received in the second
      // before a deploy is acked to the provider and then thrown away, with the
      // provider believing it succeeded. 30s covers the slowest handler.
      kill_timeout: 30000,
      env: {
        NODE_ENV: "production",
        PORT: 3000,
      },
      error_file: "./logs/skelo-error.log",
      out_file: "./logs/skelo-out.log",
      time: true,
    },
  ],
};
