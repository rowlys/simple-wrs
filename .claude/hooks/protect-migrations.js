// PreToolUse hook: block Edit/Write on Prisma migrations already tracked by git (technical spec §3.3 step 4).
// shortcut: "tracked by git" stands in for "applied"; a migration applied locally but not yet committed is not protected.
const { execFileSync } = require('child_process');

let input = '';
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  const filePath = JSON.parse(input).tool_input?.file_path ?? '';
  // only files inside a migration folder, not migration_lock.toml at the migrations root
  if (!/[\\/]backend[\\/]prisma[\\/]migrations[\\/][^\\/]+[\\/]/.test(filePath)) process.exit(0);

  try {
    execFileSync('git', ['ls-files', '--error-unmatch', '--', filePath], {
      cwd: process.env.CLAUDE_PROJECT_DIR || process.cwd(),
      stdio: 'ignore',
    });
  } catch {
    process.exit(0); // untracked, or not a git repo yet: a new migration, editing allowed
  }
  process.stderr.write(
    `Blocked: ${filePath} belongs to a migration already committed. Applied migrations are never edited; create a new migration instead (technical spec §3.3).\n`,
  );
  process.exit(2);
});
