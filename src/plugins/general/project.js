import {
  listUserProjects,
  getWebsiteProject,
  getActiveWebsiteProject,
  setActiveWebsiteProject,
  getProjectExportPreference,
  setProjectExportPreference,
  createProjectArchive,
  removeProjectArchive,
  getProjectHistory,
  getProjectLibraryStatus
} from '../../ai/project-library.js';

function formatBytes(value) {
  const bytes = Math.max(0, Number(value) || 0);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function sendArchive(sock, m, project) {
  let archive;
  try {
    archive = await createProjectArchive({ ownerId: m.sender, projectId: project.projectId });
    const buffer = await import('node:fs/promises').then(fs => fs.readFile(archive.path));
    await sock.sendMessage(m.chat, {
      document: buffer,
      mimetype: 'application/zip',
      fileName: archive.fileName,
      caption: `NEXORA PROJECT LIBRARY\n${archive.project.name}\nVersi ${archive.project.version} · ${archive.files} file\nSource repository saja. Metadata internal, folder pengguna lain, dan credentials tidak disertakan.`
    }, { quoted: m });
    return m.reply(`ZIP ${archive.fileName} berhasil dikirim.`);
  } finally {
    if (archive?.path) await removeProjectArchive(archive.path).catch(() => {});
  }
}

export default {
  name: 'project',
  aliases: ['projects', 'repo', 'repository'],
  category: 'developer',
  usage: '<list|status|use|history|zip|export> [value]',
  description: 'Kelola repository website, memori tugas, riwayat versi, dan ekspor ZIP milik pengguna',
  async execute({ sock, m, args }) {
    if (m.isGroup || String(m.chat || '').endsWith('@g.us')) {
      return m.reply('Project Library hanya tersedia di chat pribadi agar repository, memori tugas, dan ZIP tidak terbuka kepada anggota grup.');
    }
    const [rawAction = 'status', rawTarget = ''] = args;
    const action = String(rawAction).toLowerCase();
    const target = String(rawTarget || '').trim();

    if (['help', 'menu'].includes(action)) {
      return m.reply([
        '*NEXORA PROJECT LIBRARY*',
        '.project list — daftar repository milikmu',
        '.project status — repository aktif dan memori tugas',
        '.project use <slug|id> — pilih repository untuk dilanjutkan',
        '.project history — riwayat versi repository aktif',
        '.project storage — pemakaian workspace dan kuota',
        '.project zip [slug|id] — kirim ZIP repository',
        '.project export ask — kirim ZIP hanya saat diminta',
        '.project export always — kirim ZIP setiap build/update',
        '.project export off — matikan ekspor ZIP otomatis',
        '',
        'Setiap pengguna memiliki ruang penyimpanan terpisah. Preview publik sementara; source repository dan task memory tersimpan permanen sampai dihapus dari VPS.'
      ].join('\n'));
    }

    if (action === 'list' || action === 'ls') {
      const projects = await listUserProjects({ ownerId: m.sender });
      if (!projects.length) return m.reply('Belum ada repository website di Project Library milikmu. Mulai dengan meminta Ocha membuat website.');
      const lines = projects.slice(0, 20).map((project, index) =>
        `${index + 1}. *${project.name}*\n   ${project.slug} · v${project.version} · ${project.fileCount} file · ${formatBytes(project.totalBytes)}${project.gitEnabled ? ' · Git' : ''}`
      );
      return m.reply(`*NEXORA PROJECT LIBRARY · REPOSITORY KAMU*\n${lines.join('\n')}\n\nGunakan .project use <slug> untuk memilih repository.`);
    }

    if (action === 'export') {
      const mode = target.toLowerCase();
      if (!['ask', 'always', 'off'].includes(mode)) return m.reply('Gunakan: .project export ask | always | off');
      await setProjectExportPreference({ ownerId: m.sender, mode });
      const description = {
        ask: 'ZIP dikirim hanya ketika kamu meminta ekspor.',
        always: 'ZIP dikirim otomatis setelah setiap website dibuat atau diperbarui.',
        off: 'Ekspor ZIP otomatis dimatikan. Ekspor manual dengan .project zip tetap tersedia.'
      }[mode];
      return m.reply(`Preferensi ekspor repository disimpan: *${mode.toUpperCase()}*.\n${description}`);
    }

    if (action === 'use' || action === 'select' || action === 'open') {
      if (!target) return m.reply('Gunakan: .project use <slug|id>');
      const project = await getWebsiteProject({ ownerId: m.sender, projectId: target, slug: target, includeFiles: false });
      if (!project) return m.reply('Repository tidak ditemukan di Project Library milikmu.');
      await setActiveWebsiteProject({ ownerId: m.sender, chatId: m.chat, projectId: project.projectId });
      return m.reply(`Repository aktif dipilih: *${project.name}* · ${project.slug} · v${project.version}.\nKirim permintaan perubahan untuk melanjutkan pekerjaan ini.`);
    }

    if (action === 'zip' || action === 'export-zip' || action === 'download') {
      const project = target
        ? await getWebsiteProject({ ownerId: m.sender, projectId: target, slug: target, includeFiles: false })
        : await getActiveWebsiteProject({ ownerId: m.sender, chatId: m.chat, includeFiles: false });
      if (!project) return m.reply('Repository tidak ditemukan. Gunakan .project list atau .project use <slug>.');
      return sendArchive(sock, m, project);
    }

    if (action === 'history' || action === 'versions') {
      const project = await getActiveWebsiteProject({ ownerId: m.sender, chatId: m.chat, includeFiles: false });
      if (!project) return m.reply('Belum ada repository aktif di percakapan ini.');
      const history = await getProjectHistory({ ownerId: m.sender, projectId: project.projectId });
      const lines = history.length
        ? history.map(item => `• v${item.version} · ${new Date(item.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`)
        : ['Belum ada snapshot versi sebelumnya.'];
      return m.reply(`*RIWAYAT ${project.name}*\nVersi aktif: v${project.version}\n${lines.join('\n')}\n\nGit lokal: ${project.gitEnabled ? project.gitCommit || 'aktif' : 'tidak tersedia'}`);
    }

    if (action === 'memory' || action === 'tasks') {
      const project = await getActiveWebsiteProject({ ownerId: m.sender, chatId: m.chat, includeFiles: false });
      if (!project) return m.reply('Belum ada repository aktif di percakapan ini.');
      const memory = project.projectMemory || {};
      const tasks = (project.tasks || []).slice(-10).map((item, index) => `${index + 1}. ${item.request}`).join('\n');
      return m.reply([
        `*PROJECT MEMORY · ${project.name}*`,
        memory.summary || project.summary || 'Belum ada ringkasan.',
        '',
        '*Architecture*', memory.architecture || 'Belum dicatat.',
        '',
        '*Features*', ...(memory.features || []).map(item => `• ${item}`),
        '',
        '*Decisions*', ...(memory.decisions || []).map(item => `• ${item}`),
        '',
        '*Next steps*', ...(memory.nextSteps || []).map(item => `• ${item}`),
        '',
        '*Recent tasks*', tasks || 'Belum ada task.'
      ].join('\n'));
    }

    if (action === 'storage' || action === 'quota') {
      const status = await getProjectLibraryStatus({ ownerId: m.sender });
      return m.reply([
        '*NEXORA PRIVATE PROJECT WORKSPACE*',
        `Repository: ${status.projects}/${status.maxProjects}`,
        `Pemakaian kuota (source + Git + snapshot): ${formatBytes(status.storageBytes)} / ${formatBytes(status.maxStorageBytes)}`,
        `Git repositories: ${status.activeVersionedProjects}`,
        'Workspace: terisolasi per akun WhatsApp; direktori internal tidak dibagikan ke chat atau ZIP.'
      ].join('\n'));
    }

    if (action === 'status') {
      const [project, exportMode] = await Promise.all([
        getActiveWebsiteProject({ ownerId: m.sender, chatId: m.chat, includeFiles: false }),
        getProjectExportPreference({ ownerId: m.sender })
      ]);
      if (!project) return m.reply(`Belum ada repository aktif pada percakapan ini.\nPreferensi ZIP: ${exportMode.toUpperCase()}\nGunakan .project list untuk melihat repository milikmu.`);
      return m.reply([
        '*NEXORA PROJECT STATUS*',
        `Nama: ${project.name}`,
        `Repository: ${project.slug}`,
        `Versi: v${project.version}`,
        `Files: ${project.fileCount} · ${formatBytes(project.totalBytes)}`,
        `Git: ${project.gitEnabled ? `aktif (${project.gitCommit || 'commit'})` : 'fallback snapshot'}`,
        `Task memory: ${(project.tasks || []).length} task`,
        `Updated: ${new Date(project.updatedAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' })} WIB`,
        `ZIP preference: ${exportMode.toUpperCase()}`,
        `Workspace: private/${project.slug}/`
      ].join('\n'));
    }

    return m.reply('Perintah tidak dikenal. Gunakan .project help.');
  }
};
