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
