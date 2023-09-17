const express = require('express')
const cors = require('cors')
const nodemailer = require("nodemailer");
const mg = require('nodemailer-mailgun-transport');
const jwt = require('jsonwebtoken');
require('dotenv').config()
const stripe = require("stripe")(process.env.STRIPE_SECRET);


// Replace this constant with a calculation of the order's amount
// Calculate the order total on the server to prevent
// people from directly manipulating the amount on the client
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const port = process.env.PORT || 5000;
const app = express()

// middle ware
app.use(cors())
app.use(express.json())

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.b0di4c5.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverApi: ServerApiVersion.v1,
});

client.connect(err => {
  client.close();
})


function verifyJWT(req, res, next) {
  const authInfo = req.headers.authorization;
  console.log(authInfo);
  if (!authInfo) {
    return res.status(401).send('unauthorized access');
  }
  const token = authInfo.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, function (err, decoded) {
    if (err) {
      return res.status(403).send('forbidden access');
    }
    req.decoded = decoded;
    next();
  })
}


function sendMail(SendMailFound) {
  const { Email, Subject, Message } = SendMailFound;
  const auth = {
    auth: {
      api_key: process.env.MAIL_GUN_API_KEY,
      domain: process.env.MAIL_GUN_DOMAIN,
    }
  }

  const nodemailerMailgun = nodemailer.createTransport(mg(auth));

  nodemailerMailgun.sendMail({
    from: Email,
    to: process.env.TO_EMAIL, // An array if you have multiple recipients.
    subject: Subject,
    //You can use "html:" to send HTML email content. It's magic!
    html: `<b>${Message}</b>`,
    //You can use "text:" to send plain-text content. It's oldschool!
    text: 'From a person'
  }, (err, info) => {
    if (err) {
      console.log(`Error: ${err}`);
    }
    else {
      console.log(`Response: ${info}`);
    }
  });
}

async function run() {
  try {
    const appointmentOptionsCollection = client.db('VetZone').collection('appointmentOptions');
    const BookingCollection = client.db('VetZone').collection('bookings');
    const customerCollection = client.db('VetZone').collection('users');
    const doctorCollection = client.db('VetZone').collection('doctors');
    const paymentsCollection = client.db('VetZone').collection('payments');

    // verify admin in the backendSide
    async function verifyAdmin(req, res, next) {
      const decodedEmail = req.decoded.email;
      const query = { email: decodedEmail };
      const user = await customerCollection.findOne(query);
      if (user?.role !== 'admin') {
        return res.status(403).send({ message: 'forbidden access' });
      }
      next(); // Call next() if the user is an admin to proceed to the next middleware or route handler.
    }

    app.post('/payments', async (req, res) => {
      const data = req.body;
      const id = data.bookingId;
      const trID = data.transactionId;
      const filter = { _id: new ObjectId(id) };
      const option = { upsert: true };
      const updatedDoc = {
        $set: {
          paid: true,
          transactionid: trID
        }
      }
      const bookingCollec = await BookingCollection.updateOne(filter, updatedDoc, option);
      const result = await paymentsCollection.insertOne(data);
      res.send(result);
    })


    app.post('/SendMail', async (req, res) => {
      const SendMailFound = req.body;
      console.log(SendMailFound.Email);
      sendMail(SendMailFound);
      res.send({ status: 'send' })
    })

    app.get('/appointmentOptions', verifyJWT, async (req, res) => {
      const date = req.query.date;
      const query = {};
      const bookingQuery = { appointmentDate: date };
      const options = await appointmentOptionsCollection.find(query).toArray();
      const alreadyBooked = await BookingCollection.find(bookingQuery).toArray();
      options.forEach(option => {
        const optionBooked = alreadyBooked.filter(book => book.TreatmentName === option.name);
        const bookedSlots = optionBooked.map(book => book.SelectedSlot);
        const remainingSlots = option.slots.filter(slot => !bookedSlots.includes(slot))
        option.slots = remainingSlots;
      })
      res.send(options);
    })




    app.post("/create-payment-intent", async (req, res) => {
      const { payment } = req.body;
      let val = parseInt(payment);
      const amount = val * 100;
      // Create a PaymentIntent with the order amount and currency
      const paymentIntent = await stripe.paymentIntents.create({
        amount: amount,
        currency: "usd",
        "payment_method_types": [
          "card"
        ],
      });
      res.send({
        clientSecret: paymentIntent.client_secret,
      });
    });


    // problem here
    app.get('/users/admin/:email', verifyJWT, async (req, res) => {
      const email = req.params.email;
      const query = { email: email };
      const result = await customerCollection.findOne(query);
      res.send({ isAdmin: result?.role === 'admin' });
    })


    app.get('/users/:email', async (req, res) => {
      const email = req.params.email;
      console.log(email);
      const query = { email: email };
      const result = await customerCollection.findOne(query);
      res.send(result);
    })

    app.post('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const query = req.body;
      const result = await doctorCollection.insertOne(query);
      res.send(result);
    })

    app.get('/users/search/:name', async(req,res)=> {
      const name = req.params.name;
      const q = {name : name};
      const ress = await customerCollection.find(q).toArray();
      res.send(ress);
    })

    app.get('/doctors', verifyJWT, verifyAdmin, async (req, res) => {
      const query = {};
      const result = await doctorCollection.find(query).toArray();
      res.send(result);
    })

    app.delete('/doctors/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await doctorCollection.deleteOne(query);
      res.send(result);
    })

    app.put('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          role: 'admin'
        }
      }
      const result = await customerCollection.updateOne(filter, updatedDoc, options);
      res.send(result);
    })


    app.delete('/users/admin/:id', verifyJWT, verifyAdmin, async (req, res) => {

      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const updatedDoc = {
        $unset: {
          role: ""
        }
      };
      const result = await customerCollection.updateOne(filter, updatedDoc, options);
      res.send(result);
    })


    app.delete('/users/admin', async(req, res) => {
      const id = req.query.id;
      const filter = { _id: new ObjectId(id) };
      const result = await customerCollection.deleteOne(filter);
      res.send(result);
    })



    app.get('/addPrice', verifyJWT, verifyAdmin, async (req, res) => {
      const filter = {};
      const options = { upsert: true };
      const updatedDoc = {
        $set: {
          price: 99
        }
      };
      const result = await appointmentOptionsCollection.updateMany(filter, updatedDoc, options);
      res.send(result);
    })

    app.get('/bookings', verifyJWT, async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const booked = await BookingCollection.find(query).toArray();
      res.send(booked);
    })

    app.post('/users', async (req, res) => {
      const query = req.body;
      const customer = await customerCollection.insertOne(query);
      res.send(customer);
    })

    app.get('/users', async (req, res) => {
      const search = {};
      const result = await customerCollection.find(search).toArray();
      res.send(result);
    })

    app.get('/jwt', async (req, res) => {
      const email = req.query.email;
      const query = { email: email };
      const result = await customerCollection.findOne(query);
      if (result) {
        const token = jwt.sign({ email }, process.env.ACCESS_TOKEN, { expiresIn: '1h' });
        res.send({ accessToken: token });
      } else {
        res.status(403).send({ stat: 'Forbidden Access' });
      }
    })


    app.get('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await BookingCollection.findOne(query);
      res.send(result);
    })

    app.post('/bookings', verifyJWT, async (req, res) => {
      const booking = req.body;
      const query = {
        appointmentDate: booking.appointmentDate,
        TreatmentName: booking.TreatmentName,
        email: booking.email
      };
      const alreadyBooked = await BookingCollection.find(query).toArray();
      if (alreadyBooked.length) {
        const message = `you have a booking on ${booking.appointmentDate}`;
        return res.send({ acknowledged: false, message });
      }

      const result = await BookingCollection.insertOne(booking);
      res.send(result);
    })

  } finally {

    await client.close();
  }
}

run().catch();

app.get('/', async (req, res) => {
  res.send('server is running');
})
app.listen(port, () => console.log(`port : ${port} is running`))