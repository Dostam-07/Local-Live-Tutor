/* Quick offline probe of the resolver's network behavior in Node (not a test). */
process.env.NODE_ENV = "development";
const { resolveEducationalImage, clearImageCache } = await import("../src/services/images/resolver.js");

const started = Date.now();
clearImageCache();
const image = await resolveEducationalImage("the water cycle");
console.log("elapsed:", Date.now() - started, "ms");
console.log(JSON.stringify(image, null, 2));
process.exit(0);
