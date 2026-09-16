// cleanup.js
// Keeps the newest N documents in a collection, deletes everything else.
// Run: node cleanup.js

const { MongoClient, ServerApiVersion } = require("mongodb")
require("dotenv").config()

const uri = process.env.MONGODB_URI

// 👉 এখানে যে কালেকশনে 8151টা ডকুমেন্ট আছে সেটার নাম বসাও
const COLLECTION_NAME = "new-idea" // অথবা 'comments' — যেটাতে সমস্যা
const KEEP_COUNT = 20 // কতগুলো রাখতে চাও (সবচেয়ে নতুনগুলো)

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    }
})

async function cleanup() {
    try {
        await client.connect()
        const db = client.db("idea-vault")
        const collection = db.collection(COLLECTION_NAME)

        const totalCount = await collection.countDocuments()
        console.log(`Total documents in "${COLLECTION_NAME}": ${totalCount}`)

        if (totalCount <= KEEP_COUNT) {
            console.log("Nothing to delete — count is already within the keep limit.")
            return
        }

        // _id-এর মধ্যে creation timestamp এনকোড করা থাকে, তাই _id দিয়ে sort করলেই
        // সবচেয়ে নতুন ডকুমেন্টগুলো পাওয়া যায় — আলাদা date field দরকার নেই।
        const idsToKeep = await collection
            .find({}, { projection: { _id: 1 } })
            .sort({ _id: -1 }) // নতুন থেকে পুরনো
            .limit(KEEP_COUNT)
            .toArray()

        const keepIdList = idsToKeep.map((doc) => doc._id)

        const deleteResult = await collection.deleteMany({
            _id: { $nin: keepIdList }
        })

        console.log(`Deleted ${deleteResult.deletedCount} documents.`)
        console.log(`Kept the newest ${keepIdList.length} documents.`)
    } catch (err) {
        console.error("Error during cleanup:", err)
    } finally {
        await client.close()
    }
}

cleanup()
