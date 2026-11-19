import { updateConfig, getConfig } from '../../core/config.js';
const keys = {
  exec:'masterExecEnabled', eval:'masterEvalEnabled', cli:'masterCliEnabled',
  python:'masterPythonEnabled', golang:'masterGolangEnabled'
};
export default {
  name:'master', aliases:['masterconfig'], category:'owner', ownerOnly:true,
  description:'Enable or disable owner-only developer runners',
  async execute({m,args}) {
    const [feature, value] = args;
    if (!feature || feature === 'status') {
      const c=getConfig().security;
      return m.reply(Object.entries(keys).map(([name,key])=>`${name}: ${c[key]?'ON':'OFF'}`).join('\n'));
    }
    const key=keys[feature];
    if (!key || !['on','off'].includes(value)) return m.reply('Gunakan: .master status | .master eval on|off | .master exec on|off | .master cli on|off | .master python on|off | .master golang on|off');
    await updateConfig(c=>{c.security[key]=value==='on';},{actor:m.sender,reason:`master ${feature} ${value}`});
    await m.reply(`Master ${feature}: ${value.toUpperCase()}`);
  }
};
