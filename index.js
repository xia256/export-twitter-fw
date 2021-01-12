
const Twitter = require('twitter');
const fs = require('fs');

function delay(timeout) {
    timeout = Math.max(timeout, 1);
    return new Promise((resolve) => setTimeout(resolve, timeout));
}

function readTextFile(path, defaultResult) {
    if (!fs.existsSync(path)) {
        return defaultResult;
    }
    return fs.readFileSync(path, 'utf8');
}

(async function main() {
    try {

        const config = JSON.parse(readTextFile('config.json', '{}'));
        const history = JSON.parse(readTextFile('history.json', '{}'));

        if (!config.twitter || Object.values(config.twitter).some(s => !s)) {
            throw new Error(`config.twitter has not been configured`);
        }

        const client = new Twitter(config.twitter);
        const refreshTarget = config.refreshTargetHours * 60 * 60 * 1000;

        async function getUsers(getUsersAsync) {
            let cursor = undefined;
            let ids = [];

            for (; ;) {
                let limited = false;
                let users = undefined;

                try {
                    users = await getUsersAsync(cursor);
                    ids.push(...users.ids.map(id => id.toString()));
                    cursor = users.next_cursor;
                }
                catch (ex) {
                    if (Array.isArray(ex)) {
                        const [{ code }] = ex;
                        if (code == 88) { // Rate limit exceeded
                            console.log(`Hit a rate limit, waiting ${config.delay}ms to try again, time=${new Date().toLocaleString()}`)
                            await delay(config.delay);
                            continue;
                        }
                    }
                }

                console.log(`Currently have ${ids.length} ids collected, more=${cursor ? true : false}`);
                await delay(5);
                
                if (!cursor)
                    break;
            }

            const map = {};
            for (let i = 0; i < ids.length; i += 100) {
                console.log(`Mapping user ids to user objects, ${i + 1} of ${ids.length}`);

                const users = await client.get('users/lookup', {
                    user_id: [...ids].splice(i, 100).join(',') // take up to 100
                });

                for (const user of users) {
                    map[user.id_str] = user;
                }
            }

            return ids.map(id => map[id]).filter(user => user);
        }

        const out_following = ['Source,Target'];
        const out_followers = ['Source,Target'];
        const all_users = ['id,Label'];
        const all_map = {};

        const targets = readTextFile('targets.txt', '').split('\n').map(s => s.trim().replace('@', ''));
        for (const target of targets) {
            console.log(`Working on target=${target}`);
            const now = Date.now();

            let [{ screen_name, id_str }] = (await client.get('users/lookup', {
                screen_name: target
            }));

            let followers, following;

            if (!history[id_str] || (now - history[id_str].time) >= refreshTarget) {
                console.log(`Need to refresh data on target=${target}, id=${id_str}`);

                followers = await getUsers(async (cursor) => await client.get('followers/ids', {
                    screen_name: screen_name,
                    stringify_ids: true,
                    cursor
                }));

                following = await getUsers(async (cursor) => await client.get('friends/ids', {
                    screen_name: screen_name,
                    stringify_ids: true,
                    cursor
                }));

                history[id_str] = {
                    screen_name,
                    time: now
                };

                fs.writeFileSync(`data/history/${id_str}.followers.json`, JSON.stringify(followers), 'utf8');
                fs.writeFileSync(`data/history/${id_str}.following.json`, JSON.stringify(following), 'utf8');
                fs.writeFileSync('history.json', JSON.stringify(history), 'utf8');
            }
            else {
                followers = JSON.parse(readTextFile(`data/history/${id_str}.followers.json`));
                following = JSON.parse(readTextFile(`data/history/${id_str}.following.json`));

                console.log(`We have history on target=${target}, id=${id_str} so not pulling new data, followers=${followers.length}, following=${following.length}`);
            }

            const $all_map = [{ id_str, screen_name }, ...followers, ...following].reduce((acc, user) => (acc[user.id_str] = user, acc), all_map);
            const $out_following = following.map(user => `${id_str},${user.id_str}`);
            const $out_followers = followers.map(user => `${user.id_str},${id_str}`);

            out_following.push(...$out_following);
            out_followers.push(...$out_followers);
        }

        all_users.push(...Object.values(all_map).map(user => `${user.id_str},@${user.screen_name}`));

        fs.writeFileSync('data/following.csv', Array.from(new Set(out_following)).join('\r\n'), 'utf8');
        fs.writeFileSync('data/followers.csv', Array.from(new Set(out_followers)).join('\r\n'), 'utf8');
        fs.writeFileSync('data/nodes.csv', all_users.join('\r\n'), 'utf8');
        fs.writeFileSync('history.json', JSON.stringify(history, null, 2), 'utf8');
    }
    catch (ex) {
        return console.error(ex);
    }
})();