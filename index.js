const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');

dotenv.config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
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


async function run() {
    try {
        // Connect the client to the server	(optional starting in v4.7)
        await client.connect();


        const db = client.db('idea-vault');
        const newIdeaCollection = db.collection('new-idea');
        const commentCollection = db.collection('comments');


        app.get('/new-idea', async (req, res) => {
            const data = await newIdeaCollection.find();
            const result = await data.toArray();
            res.json(result)
        })

        app.post('/new-idea', async (req, res) => {
            const newIdeaData = req.body;
            console.log(newIdeaData)
            const result = await newIdeaCollection.insertOne(newIdeaData)

            res.json(result)
        })

        app.post('/comments', async (req, res) => {
            const commentData = req.body;
            console.log(commentData)
            const result = await commentCollection.insertOne(commentData)

            res.json(result)
        })


        app.get('/new-idea/:id', async (req, res) => {
            const id = req.params.id;

            const result = await newIdeaCollection.findOne({ _id: new ObjectId(id) });
            res.json(result)
        })

        app.patch('/update-idea/:id', async (req, res) => {
            const id = req.params.id;
            const updatedData = req.body;

            const result = await newIdeaCollection.updateOne({ _id: new ObjectId(id) }, { $set: updatedData });
            res.json(result);
        });

        app.get('/comments', async (req, res) => {
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