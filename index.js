const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const { createRemoteJWKSet, jwtVerify } = require('jose-cjs');
const uri = process.env.MONGODB_URI;
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 5000;

const client = new MongoClient(uri, {
    serverApi: {
        version: ServerApiVersion.v1,
        strict: true,
        deprecationErrors: true,
    }
});

const JWKS = createRemoteJWKSet(
    new URL('http://localhost:3000/api/auth/jwks')
);

const verifyToken = async (req, res, next) => {
    const authHeader = req?.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    const token = authHeader?.split(' ')[1];

    if (!token) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    try {
        const { payload } = await jwtVerify(token, JWKS)
        console.log("Verified Payload:", payload)
        next()
    } catch (error) {
        return res.status(401).json({ message: 'Unauthorized' });
    }
    // console.log(token)
    
}



async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();


        const db = client.db('idea-vault');
        const newIdeaCollection = db.collection('new-idea');
        const commentCollection = db.collection('comments');


        // app.get('/new-idea', async (req, res) => {
        //     const data = await newIdeaCollection.find();
        //     const result = await data.toArray();
        //     res.json(result)
        // })


        app.get('/new-idea', verifyToken, async (req, res) => {
            const { search, category } = req.query;

            const query = {};

            if (search) {
                query.$or = [
                    { startupName: { $regex: search, $options: 'i' } },
                    { shortDescription: { $regex: search, $options: 'i' } }
                ];
            }

            if (category) {
                query.tags = { $regex: category, $options: 'i' };
            }

            const data = await newIdeaCollection.find(query);
            const result = await data.toArray();
            res.json(result);
        });

        app.get("/new-idea/latest", async (req, res) => {
            const cursor = newIdeaCollection.find().limit(6);
            const result = await cursor.toArray();
            res.send(result);
        });

        app.post('/new-idea', verifyToken, async (req, res) => {
            const newIdeaData = req.body;
            console.log(newIdeaData)
            const result = await newIdeaCollection.insertOne(newIdeaData)

            res.json(result)
        })

        app.post('/comments', verifyToken, async (req, res) => {
            const commentData = req.body;
            console.log(commentData)
            const result = await commentCollection.insertOne(commentData)

            res.json(result)
        })


        app.get('/new-idea/:id', verifyToken, async (req, res) => {
            const id = req.params.id;

            const result = await newIdeaCollection.findOne({ _id: new ObjectId(id) });
            res.json(result)
        })

        app.patch('/update-idea/:id', verifyToken, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            const result = await newIdeaCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedData });
            res.json(result);
        });

        app.patch('/update-comments/:id',verifyToken, async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            const result = await commentCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedData });
            res.json(result);
        });

        app.delete('/delete-idea/:id',verifyToken, async (req, res) => {
            const id = req.params.id;

            const result = await newIdeaCollection.deleteOne({ _id: new ObjectId(id) });
            res.json(result);
        });

        app.delete('/delete-comments/:id', verifyToken, async (req, res) => {
            const id = req.params.id;

            const result = await commentCollection.deleteOne({ _id: new ObjectId(id) });
            res.json(result);
        });

        app.get('/comments',verifyToken, async (req, res) => {
            const data = await commentCollection.find();
            const result = await data.toArray();
            res.json(result)
        })


        // Send a ping to confirm a successful connection
        await client.db("admin").command({ ping: 1 });
        console.log("Pinged your deployment. You successfully connected to MongoDB!");
    } finally {
        // Ensures that the client will close when you finish/error
        // await client.close();
    }
}
run().catch(console.dir);


app.get('/', (req, res) => {
    res.send('Server is running');
});


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

