export default {
  name:'ping', aliases:['speed','latency'], category:'general', description:'Latency check',
  async execute({m}) { const start=Date.now(); await m.reply(`Pong · ${Date.now()-start} ms`); }
};
