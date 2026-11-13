import { execFile } from 'child_process';

/**
 * A stable identifier for the project being toured.
 *
 * Folder names are not stable: two people can clone the same repository into
 * differently named directories, and they would then never see each other's
 * tours. The git remote is the same for everyone, so it is used when there is
 * one, with the folder name as the fallback for projects that are not in git.
 */

/**
 * Turn a git remote URL into a comparable key: `github.com/acme/widgets`.
 * Credentials, protocol, port and a trailing `.git` are all dropped, because the
 * same repository is often cloned over SSH by one person and HTTPS by another.
 */
export function projectKeyFromRemote(remoteUrl: string | undefined | null): string | null {
    const raw = (remoteUrl || '').trim();
    if (!raw) return null;

    let rest: string;
    const scpLike = raw.match(/^[^/@]+@([^:]+):(.+)$/); // git@github.com:acme/widgets.git
    if (scpLike) {
        rest = `${scpLike[1]}/${scpLike[2]}`;
    } else {
        const withScheme = raw.match(/^[a-zA-Z][\w+.-]*:\/\/(.+)$/); // https://, ssh://, git://
        rest = withScheme ? withScheme[1] : raw;
        rest = rest.replace(/^[^/@]*@/, ''); // user:token@host
    }

    rest = rest
        .replace(/:\d+\//, '/')       // host:2222/path
        .replace(/\.git$/i, '')
        .replace(/\/+$/, '')
        .toLowerCase();

    return rest || null;
}

/** Read `remote.origin.url` for a folder, or undefined if it is not a git repo. */
function gitRemote(folder: string): Promise<string | undefined> {
    return new Promise((resolve) => {
        execFile('git', ['-C', folder, 'remote', 'get-url', 'origin'], { timeout: 5000 },
            (err, stdout) => resolve(err ? undefined : stdout.trim() || undefined));
    });
}

/**
 * The key used to group tours. Falls back to the folder name, lowercased, so a
 * project without a git remote still works — it is just folder-name-scoped, as
 * before.
 */
export async function resolveProjectKey(folder: string, projectName: string): Promise<string> {
    const fromRemote = projectKeyFromRemote(await gitRemote(folder));
    return fromRemote || projectName.trim().toLowerCase();
}
