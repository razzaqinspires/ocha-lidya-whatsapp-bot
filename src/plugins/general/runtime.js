import os from 'node:os';
export default {
  name:'runtime', aliases:['system','sysinfo'], category:'developer', description:'Runtime, memory, host and process health',
  async execute({m,config}) {
    const mem=process.memoryUsage();
    const mb=n=>(n/1024/1024).toFixed(1);
    const text=[
      '*OCHA LIDYA · RUNTIME*',
      `Node.js: ${process.version}`,
      `Platform: ${process.platform}/${process.arch}`,
      `Hostname: ${os.hostname()}`,
      `CPU: ${os.cpus()?.[0]?.model || 'unknown'}`,
      `Uptime: ${(process.uptime()/3600).toFixed(2)} hours`,
      `RSS: ${mb(mem.rss)} MB`,
      `Heap: ${mb(mem.heapUsed)} / ${mb(mem.heapTotal)} MB`,
      `Mode: ${config.mode}`,
      `Prefix: ${config.prefix.mode}`
    ].join('\n');
    await m.reply(text);
  }
};
