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

export { login, resolveDescendantsData };