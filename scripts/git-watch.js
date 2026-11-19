import 'dotenv/config';
import { startAutoGitSync } from '../src/core/auto-git-sync.js';

startAutoGitSync();
console.log('Auto Git Sync watcher is running. Press Ctrl+C to stop.');
