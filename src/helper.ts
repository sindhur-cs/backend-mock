import { apiKey, baseUrl, mail, password } from "./config";
import { EntryReferenceResolver, InvokingService } from "../../entry_references_sdk";
import axios from "axios";
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

const bfs = async (queue: any, visited: any, res: any) => {
    const headers = {
        api_key: apiKey,
        authtoken: await login(),
        "Content-Type": "application/json",
    };

    let chunked = [];

    try {
        while(queue.length > 0) {
            const frontNode = queue.shift();
            const ref = frontNode.ref;
            const currLevel = frontNode.level;
            
            console.log(ref, frontNode);

            // API call for each item's descendants
            const descendants = await axios.get(
                `https://app.contentstack.com/api/v3/content_types/${ref._content_type_uid || ref.type}/entries/${ref.uid}/descendants?locale=${ref.locale}`,
                { headers }
            );

            const descendantsData: any = await descendants.data;

            chunked.push(descendantsData);

            const references = descendantsData.entries_references;
  
            references.forEach((ref: any) => {
                // if not visited
                if(!visited.has(ref.uid)) {
                    queue.push({ ref, level: currLevel + 1 });
                    visited.add(ref.uid);
                }
            });

            if(queue.length > 0 && currLevel !== queue[0].level) {
                res.write(JSON.stringify({ items: chunked }) + "\n")
                chunked = [];
            }
        }

        res.write(JSON.stringify({ items: chunked }) + "\n");
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