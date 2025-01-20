import { PORT } from "./config";
import app from "./app";

app.listen(PORT, () => {
    console.log(`Server running at ${PORT}`);
});