
const Twitter = require('twitter');
const fs = require('fs');

const config = {
    target: "thenovusphere", // the account name we're targeting
    delay: 0, // if you have more than 50,000 followers this should be set to true
    //
    // go to: https://developer.twitter.com/en/portal/projects-and-apps
    // make a standalone app
    // go into keys and tokens
    //
    twitter: {
        "consumer_key": "", // api key
        "consumer_secret": "", // api key secret
        "access_token_key": "", // authentication token key
        "access_token_secret": "" // authentication token secret
    }
};

(async function main() {

    try {

        if (Object.values(config.twitter).some(s => !s)) {
            throw new Error(`config.twitter has not been configured`);
        }

        const client = new Twitter(config.twitter);

        function delay(timeout) {
            timeout = Math.max(timeout, 1);
            return new Promise((resolve) => setTimeout(resolve, timeout));
        }

        async function getUsers(delayMs, getUsersAsync) {
            let cursor = undefined;
            let ids = [];

            do {
                const users = await getUsersAsync(cursor);

                ids.push(...users.ids);
                cursor = users.next_cursor;

                console.log(`Currently have ${ids.length} ids collected, more=${cursor ? true : false}, waiting ${delayMs}ms`);
                await delay(delayMs);
            }
            while (cursor);

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

            return ids.map(id => map[id]);
        }

        let [{ screen_name, id_str }] = (await client.get('users/lookup', {
            screen_name: config.target
        }));

        const followers = await getUsers(config.delay, async (cursor) => await client.get('followers/ids', {
            screen_name: screen_name,
            stringify_ids: true,
            cursor
        }));

        const following = await getUsers(config.delay, async (cursor) => await client.get('friends/ids', {
            screen_name: screen_name,
            stringify_ids: true,
            cursor
        }));

        const allMap = [{ id_str, screen_name }, ...followers, ...following].reduce((acc, user) => (acc[user.id_str] = user, acc), {});

        const out_following = following.map(user => `${id_str},@${screen_name},${user.id_str},@${user.screen_name}`);
        const out_followers = followers.map(user => `${user.id_str},@${user.screen_name},${id_str},@${screen_name}`);
        const all_users = Object.values(allMap).map(user => `${user.id_str},@${user.screen_name}`);

        out_following.unshift('id,screen_name,following_id,following_sn');
        out_followers.unshift('id,screen_name,following_id,following_sn');
        all_users.unshift('id,screen_name');

        fs.writeFileSync('following.csv', out_following.join('\r\n'), 'utf8');
        fs.writeFileSync('followers.csv', out_followers.join('\r\n'), 'utf8');
        fs.writeFileSync('nodes.csv', all_users.join('\r\n'), 'utf8');

    }
    catch (ex) {
        console.log(ex);
    }


})();