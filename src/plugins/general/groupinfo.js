export default {
  name:'groupinfo', aliases:['gcinfo'], category:'general', groupOnly:true, description:'Group metadata summary',
  async execute({sock,m}) {
    const meta=await sock.groupMetadata(m.chat);
    const admins=(meta.participants||[]).filter(p=>p.admin).length;
    await m.reply(`*${meta.subject||'Group'}*\nID: ${m.chat}\nOwner: ${meta.owner||'-'}\nMembers: ${meta.participants?.length||0}\nAdmins: ${admins}\nCreated: ${meta.creation ? new Date(meta.creation*1000).toLocaleString('id-ID') : '-'}`);
  }
};
