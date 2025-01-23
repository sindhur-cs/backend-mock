import { apiKey, baseUrl, mail, password } from "./config";
import { EntryReferenceResolver, InvokingService } from "../../entry_references_sdk";
import axios from "axios";
import { Headers } from "./types";

const ITEM_TYPES = {
    ENTRY: "entry"
}

const login = async () => {
    try {
        const loginRes = await axios.post(`https://${baseUrl}/v3/user-session`, {
            user: {
                email: mail,
                password
            }
        });

        const loginData: any = await loginRes.data;

        return loginData.user.authtoken;
    }
    catch(error) {
        console.log(error);
        return null;
    }
}

const itemRetriever = {
    getItem: async (uid: string, branch: string, language: string, type: string, contentType: string) => {
        const headers = {
            api_key: apiKey,
            authtoken: await login(),
            "Content-Type": "application/json"
        };
        
        const entryResponse = await axios.get(`https://app.contentstack.com/api/v3/content_types/${contentType}/entries/${uid}/descendants?locale=${language}`, { headers });

        let entryData: any = await entryResponse.data;

        entryData = {
            ...entryData,
            _metadata : {
                references: entryData.entries_references
            }
        }

        return entryData;
    }
}

const _referenceProcess = (resolvedData: any[]) => ({
    process: (refs: any) => resolvedData.push(refs)
});

const resolveDescendantsData = async (descendantsData: any, locale: string) => {
    try {
        const resolvedData: any[] = [];
        const entryReferenceResolver = new EntryReferenceResolver();
        const modifiedDescendantsData = {
            ...descendantsData,
            _metadata: {
                references: descendantsData.entries_references
            }
        }

        delete modifiedDescendantsData.entries_references;

        await entryReferenceResolver.resolve(modifiedDescendantsData, itemRetriever, _referenceProcess(resolvedData), 10, InvokingService.CMA, "main", locale);

        return resolvedData;
    }
    catch(error) {
        console.log(error);
        return [];
    }
}

const bfs = async (queue: any, visited: any, res: any, headers: Headers, locales: any) => {
    let chunked: any[] = [];

    try {
        while(queue.length > 0) {
            const frontNode = queue.shift();
            const ref = frontNode.ref;
            const currLevel = frontNode.level;

            await Promise.all(locales.map(async (locale: any) => {
                // API call for each item's descendants
                const descendants = await axios.get(
                    `https://app.contentstack.com/api/v3/content_types/${ref._content_type_uid || ref.type}/entries/${ref.uid}/descendants?locale=${locale.code}`,
                    { headers }
                );

                const descendantsData: any = await descendants.data;

                // filter the entries_references
                const filteredReferences = descendantsData.entries_references.map((ref: any) => {
                    return {
                        uid: ref.uid,
                        title: ref.title,
                        locale: locale.code,
                        // if the current locale matches the ref.locale sure it is localised and no fallback
                        fallback_locale: (locale.fallback_locale) ? (locale.code === ref.locale) ? locale.fallback_locale : ref.locale : null,
                        ...((locale.code === ref.locale) ? { localised: true } : { localised: false }),
                        version: ref._version,
                        content_type_uid: ref._content_type_uid,
                    }
                });

                const filteredData = {
                    uid: descendantsData.uid,
                    title: descendantsData.title,
                    locale: locale.code,
                    // if the current locale matches the descendantsData.locale sure it is localised and no fallback
                    fallback_locale: (locale.fallback_locale) ? (locale.code === descendantsData.locale) ? locale.fallback_locale : descendantsData.locale : null,
                    ...(locale.code === descendantsData.locale ? { localised: true } : { localised: false }),
                    version: descendantsData._version,
                    content_type_uid: descendantsData._content_type_uid,
                    references: filteredReferences
                }

                chunked.push(filteredData);

                const references = descendantsData.entries_references;
    
                references.forEach((ref: any) => {
                    // if not visited
                    if(!visited.has(ref.uid)) {
                        visited.add(ref.uid);
                        queue.push({ ref, level: currLevel + 1 });
                    }
                });
            }));

            // when the current level ends send the chunk to the client
            if(queue.length > 0 && currLevel !== queue[0].level) {
                res.write(JSON.stringify({ items: chunked, _is_last_chunk: false }) + "\n")
                chunked = [];
            }
        }

        // send the last chunk
        res.write(JSON.stringify({ items: chunked, _is_last_chunk: true }) + "\n");
        res.end();
    }
    catch(error) {
        console.log(error);
        res.status(500).json({
            message: "Server error"
        });
    }   
}

export { login, resolveDescendantsData, bfs };