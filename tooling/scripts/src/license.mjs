import { execSync } from 'child_process';
import { readFileSync } from 'fs';
import path from 'path';

const endpoint = 'https://makerkit.dev/api/license/check';

async function checkLicense() {
  let gitUser, gitEmail;

  try {
    gitUser = execSync('git config user.username').toString().trim();

    if (!gitUser) {
      gitUser = execSync('git config user.name').toString().trim();
    }

    gitEmail = execSync('git config user.email').toString().trim();
  } catch (error) {
    console.warn(`Error checking git user: ${error.message}`);
  }

  if (!gitUser && !gitEmail) {
    throw new Error(
      "Please set the git user name with the command 'git config user.username <username>'. The username needs to match the GitHub username in your Makerkit organization.",
    );
  }

  try {
    gitEmail = execSync('git config user.email').toString().trim();
  } catch (error) {
    console.info('Error getting git config:', error.message);

    if (!gitUser) {
      throw new Error(
        "Please set the git user name with the command 'git config user.username <username>'. The username needs to match the GitHub username in your Makerkit organization.",
      );
    }
  }

  const searchParams = new URLSearchParams();

  searchParams.append('username', gitUser);

  if (gitEmail) {
    searchParams.append('email', gitEmail);
  }

  try {
    const makerkitConfig =
      JSON.parse(
        readFileSync(path.resolve(process.cwd(), '../../.makerkitrc'), 'utf8'),
      ) || {};

    if (makerkitConfig.projectName) {
      searchParams.append('projectName', makerkitConfig.projectName);
    }

    if (makerkitConfig.username) {
      searchParams.append('projectUsername', makerkitConfig.username);
    }
  } catch {}

  const res = await fetch(`${endpoint}?${searchParams.toString()}`);

  if (res.status === 200) {
    return Promise.resolve();
  } else {
    return Promise.reject(
      new Error(
        `License check failed. Please set the git user name with the command 'git config user.username <username>'. The username needs to match the GitHub username in your Makerkit organization.`,
      ),
    );
  }
}

function checkVisibility() {
  let remoteUrl;

  try {
    remoteUrl = execSync('git config --get remote.origin.url')
      .toString()
      .trim();
  } catch (error) {
    return Promise.resolve();
  }

  if (!remoteUrl.includes('github.com')) {
    return Promise.resolve();
  }

  let ownerRepo;

  if (remoteUrl.startsWith('https://github.com/')) {
    ownerRepo = remoteUrl.slice('https://github.com/'.length);
  } else if (remoteUrl.startsWith('git@github.com:')) {
    ownerRepo = remoteUrl.slice('git@github.com:'.length);
  } else {
    return;
  }

  ownerRepo = ownerRepo.replace(/\.git$/, '');

  return fetch(`https://api.github.com/repos/${ownerRepo}`)
    .then((res) => {
      if (res.status === 200) {
        return res.json();
      } else if (res.status === 404) {
        return Promise.resolve();
      } else {
        return Promise.reject(
          new Error(
            `GitHub API request failed with status code: ${res.status}`,
          ),
        );
      }
    })
    .then((data) => {
      if (data && !data.private) {
        console.error(
          'The repository has been LEAKED on GitHub. Please delete the repository. A DMCA Takedown Request will automatically be requested in the coming hours.',
        );

        process.exit(1);
      }
    });
}

async function isOnline() {
  const { lookup } = await import('dns');

  try {
    return await new Promise((resolve, reject) => {
      lookup('google.com', (err) => {
        if (err && err.code === 'ENOTFOUND') {
          reject(false);
        } else {
          resolve(true);
        }
      });
    }).catch(() => false);
  } catch (e) {
    return false;
  }
}

async function main() {
  try {
    const isUserOnline = await isOnline();

    // disable the check if the user is offline
    if (!isUserOnline) {
      return process.exit(0);
    }

    await checkVisibility();

    await checkLicense().catch((error) => {
      console.error(`Check failed with error: ${error.message}`);
      process.exit(1);
    });
  } catch (error) {
    console.error(`Check failed with error: ${error.message}`);

    process.exit(1);
  }
}

void main();
