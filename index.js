const express = require("express")
const dotenv = require("dotenv")
const cors = require("cors")
const { Ratelimit } = require("@upstash/ratelimit")
const { Redis } = require("@upstash/redis")

dotenv.config()
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb")
const { createRemoteJWKSet, jwtVerify } = require("jose-cjs")
const uri = process.env.MONGODB_URI

const app = express()
app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 5000
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true
    }
})

const JWKS = createRemoteJWKSet(new URL(`${process.env.CLIENT_URL}/api/auth/jwks`))

const verifyToken = async (req, res, next) => {
    const authHeader = req?.headers.authorization

    if (!authHeader) {
        return res.status(401).json({ message: "Unauthorized" })
    }

    const token = authHeader?.split(" ")[1]

    if (!token) {
        return res.status(401).json({ message: "Unauthorized" })
    }

    try {
        const { payload } = await jwtVerify(token, JWKS)
        console.log("Verified Payload:", payload)
        next()
    } catch (error) {
        return res.status(401).json({ message: "Unauthorized" })
    }
    // console.log(token)
}

// Vercel (serverless) এ প্রতিটা রিকোয়েস্ট আলাদা function instance-এ যেতে পারে,
// তাই req.ip সঠিকভাবে পেতে এটা লাগবে (নাহলে সবার IP একরকম দেখাতে পারে)
app.set("trust proxy", 1)

// ---------- Rate Limiters (Upstash Redis) ----------
// Redis সার্ভারলেস-ফ্রেন্ডলি এবং সব function instance জুড়ে state শেয়ার করে,
// প্রতিটা রিকোয়েস্টে extra DB write-ও লাগে না (MongoDB store-এর চেয়ে দ্রুত)।

const redis = new Redis({
    url: process.env.UPSTASH_REDIS_REST_URL,
    token: process.env.UPSTASH_REDIS_REST_TOKEN
})

// সব রুটের জন্য সাধারণ লিমিট (per-IP)
const generalRatelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(100, "15 m"), // প্রতি IP থেকে 15 মিনিটে সর্বোচ্চ 100 রিকোয়েস্ট
    prefix: "ratelimit:general"
})

// write (POST/PATCH/DELETE) রুটের জন্য কড়া লিমিট
const writeRatelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(10, "15 m"), // 15 মিনিটে সর্বোচ্চ 10টা write অপারেশন
    prefix: "ratelimit:write"
})

// পাবলিক (auth ছাড়া) রুটের জন্য আলাদা কড়া লিমিট — সবচেয়ে সহজ টার্গেট
const publicRatelimit = new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(30, "5 m"), // প্রতি IP থেকে 5 মিনিটে সর্বোচ্চ 30 রিকোয়েস্ট
    prefix: "ratelimit:public"
})

// Ratelimit ইনস্ট্যান্স নিয়ে একটা Express middleware বানিয়ে দেয়
const rateLimitMiddleware = (ratelimit) => async (req, res, next) => {
    const identifier = req.ip
    const { success, limit, remaining, reset } = await ratelimit.limit(identifier)

    res.setHeader("X-RateLimit-Limit", limit)
    res.setHeader("X-RateLimit-Remaining", remaining)
    res.setHeader("X-RateLimit-Reset", reset)

    if (!success) {
        return res.status(429).json({ message: "Too many requests, please try again later." })
    }

    next()
}

const generalLimiter = rateLimitMiddleware(generalRatelimit)
const writeLimiter = rateLimitMiddleware(writeRatelimit)
const publicReadLimiter = rateLimitMiddleware(publicRatelimit)

// সব রুটে গ্লোবালি বেসলাইন প্রোটেকশন
app.use(generalLimiter)

async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect()

        const db = client.db("idea-vault")
        const newIdeaCollection = db.collection("new-idea")
        const commentCollection = db.collection("comments")

        // app.get('/new-idea', async (req, res) => {
        //     const data = await newIdeaCollection.find();
        //     const result = await data.toArray();
        //     res.json(result)
        // })

        app.get("/new-idea", verifyToken, async (req, res) => {
            const { search, category } = req.query

            const query = {}

            if (search) {
                query.$or = [
                    { startupName: { $regex: search, $options: "i" } },
                    { shortDescription: { $regex: search, $options: "i" } }
                ]
            }

            if (category) {
                query.tags = { $regex: category, $options: "i" }
            }

            const data = await newIdeaCollection.find(query)
            const result = await data.toArray()
            res.json(result)
        })

        // পাবলিক এন্ডপয়েন্ট — auth নেই, তাই আলাদা কড়া publicReadLimiter বসানো হয়েছে
        app.get("/new-idea/latest", publicReadLimiter, async (req, res) => {
            const cursor = newIdeaCollection.find().sort({ _id: -1 }).limit(6)
            const result = await cursor.toArray()
            res.send(result)
        })

        app.post("/new-idea", writeLimiter, verifyToken, async (req, res) => {
            const newIdeaData = req.body
            console.log(newIdeaData)
            const result = await newIdeaCollection.insertOne(newIdeaData)

            res.json(result)
        })

        app.post("/comments", writeLimiter, verifyToken, async (req, res) => {
            const commentData = req.body
            console.log(commentData)
            const result = await commentCollection.insertOne(commentData)

            res.json(result)
        })

        app.get("/new-idea/:id", verifyToken, async (req, res) => {
            const id = req.params.id

            const result = await newIdeaCollection.findOne({ _id: new ObjectId(id) })
            res.json(result)
        })

        app.patch("/update-idea/:id", writeLimiter, verifyToken, async (req, res) => {
            const id = req.params.id
            const updatedData = req.body

            const result = await newIdeaCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedData })
            res.json(result)
        })

        app.patch("/update-comments/:id", writeLimiter, verifyToken, async (req, res) => {
            const id = req.params.id
            const updatedData = req.body

            const result = await commentCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedData })
            res.json(result)
        })

        app.delete("/delete-idea/:id", writeLimiter, verifyToken, async (req, res) => {
            const id = req.params.id

            const result = await newIdeaCollection.deleteOne({ _id: new ObjectId(id) })
            res.json(result)
        })

        app.delete("/delete-comments/:id", writeLimiter, verifyToken, async (req, res) => {
            const id = req.params.id

            const result = await commentCollection.deleteOne({ _id: new ObjectId(id) })
            res.json(result)
        })

        app.get("/comments", verifyToken, async (req, res) => {
            const data = await commentCollection.find()
            const result = await data.toArray()
            res.json(result)
        })

        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 })
        console.log("Pinged your deployment. You successfully connected to MongoDB!")
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir)

app.get("/", (req, res) => {
    res.send("Server is running")
})

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`)
})
