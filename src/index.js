import express from 'express';
import path from 'path';
import { fileURLToPath } from "url";
import { dirname } from 'path';
import bodyParser from 'body-parser'; 
import pg from 'pg'; 
import bcrypt from 'bcrypt';
import session from "express-session";
import passport from "passport";
import { Strategy } from "passport-local";
import GoogleStrategy from 'passport-google-oauth2';
import axios from 'axios';
import env from "dotenv";
env.config();

const db = new pg.Client({
    user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_NAME,
    password: process.env.DB_PASSWORD,
    port: process.env.DB_PORT,
});

db.connect();

const app = express(); 
const port = 3000;
let setRounds = 10; 

const __dirname = dirname(fileURLToPath(import.meta.url));
const staticPath = path.join(__dirname, "../public");

app.use(express.static(staticPath));
app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');

app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: true,
    cookie: {
        maxAge: 60 * 60 * 60 * 24, 
    }
}));

app.use(passport.initialize());
app.use(passport.session());

app.get("/", (req, res) => {
    console.log("running homepage.html file");
    res.sendFile(path.join(staticPath, 'homepage.html'));
});

app.get("/auth/google", passport.authenticate("google", {
    scope: ["profile", "email"],
}));

app.get("/auth/google/movies", passport.authenticate("google", {
    successRedirect: "/movies",
    failureRedirect: "/"
}));

app.get("/movies", async (req, res) => {
    if (req.isAuthenticated()) {
        const response = await axios.get(`https://www.omdbapi.com/?s=movie&page=1&apikey=${process.env.OMDB_API_KEY}`); 
        const result = response.data; 
        res.render("movies", { data: result });
    } else {
        res.redirect("/");
    }
});

app.post("/searchedMovie", async (req, res) => {
    let movie = req.body.searchedMovie;
    res.redirect(`/movies/${movie}`);
});

app.get("/movies/:movie", async (req, res) => {
    let movie = req.params.movie;
    let userId = req.user.id; 
    try {
        const response = await axios.get(`http://www.omdbapi.com/?t=${movie}&apikey=${process.env.OMDB_API_KEY}`);
        const result = response.data;
        console.log(result.Title);
        let imdbID = result.imdbID;

        let allReview = await db.query(`select movie_review , user_id , email , movie_id from movie_review as m inner join user_info as u on m.user_id = u.id where imdb_id = ($1)`, [imdbID]);
        console.log(allReview);
        if (result.Response === "False") {
            res.send("movie not found!");
        } else {
            res.render("searchedMovies", { movie: result, review: allReview, user: userId });
        }
    } catch (error) {
        console.error("Error fetching movie details:", error);
        res.render("searchedMovies", { movie: null, error: error.message }); 
    }
});

app.post("/addReview", async (req, res) => {
    try {
        let review = req.body.review;
        let title = req.query.title; 
        let imdbID = req.query.imdbID; 
        let userId = req.user.id;

        await db.query("INSERT INTO movie_review (imdb_id, movie_name, movie_review, user_id) VALUES ($1, $2, $3, $4)", [imdbID, title, review, userId]);
        let allReview = await db.query(`select movie_review , movie_id , user_id , email , movie_id from movie_review as m inner join user_info as u on m.user_id = u.id where imdb_id = ($1)`, [imdbID]);
        const response = await axios.get(`http://www.omdbapi.com/?t=${title}&apikey=${process.env.OMDB_API_KEY}`);
        const result = response.data;

        if (result.Response === "False") {
            res.send("movie not found!");
        } else {
            res.render("searchedMovies", { movie: result, review: allReview, user: userId });
        }
    } catch (error) {
        console.error("Error adding review:", error);
        res.status(500).send("An error occurred while adding the review");
    }
});

app.post("/deleteReview", async (req, res) => {
    let reviewID = req.query.movieID; 
    let userId = req.user.id; 
    let imdbID = req.query.imdbID;
    let title = req.query.title; 

    await db.query("delete from movie_review where movie_id = ($1)", [reviewID]);
    let allReview = await db.query(`select movie_review , user_id , email , movie_id from movie_review as m inner join user_info as u on m.user_id = u.id where imdb_id = ($1)`, [imdbID]);
    const response = await axios.get(`http://www.omdbapi.com/?t=${title}&apikey=${process.env.OMDB_API_KEY}`);
    const result = response.data;

    if (result.Response === "False") {
        res.send("movie not found!");
    } else {
        res.render("searchedMovies", { movie: result, review: allReview, user: userId });
    }
});

app.post("/login", passport.authenticate("local", {
    successRedirect: "/movies",
    failureRedirect: "/"
}));

app.get("/login", (req, res) => {
    res.sendFile(path.join(staticPath, 'homepage.html'));
});

app.get("/register", (req, res) => {
    res.sendFile(path.join(staticPath, 'register.html'));
});

app.post("/Register", async (req, res) => {
    let email = req.body.username; 
    let password = req.body.password;

    const result = await db.query(`select * from user_info where email = ($1)`, [email]); 
    if (result.rows.length > 0) {
        console.log("email is already registered!");
        res.send("email is already registered pls try to log in !");
    } else {
        let hashedPassword = await bcrypt.hash(password, setRounds);
        await db.query(`insert into user_info (email, password) values ($1, $2)`, [email, hashedPassword]);
        res.redirect("/login");
    }
});

app.get("/page", async (req, res) => {
    let id = req.query.i; 
    const response = await axios.get(`https://www.omdbapi.com/?s=movie&page=${id}&apikey=${process.env.OMDB_API_KEY}`);
    let result = response.data;
    res.render("movies", { data: result });
});

app.post("/addToMyList", async (req, res) => {
    let userId = req.user.id; 
    let movie = req.query.movieName;

    await db.query("insert into myList (moviename, movieid) values ($1, $2)", [movie, userId]);
    res.redirect(`movies/${movie}`);
});

app.get("/myList", async (req, res) => {
    let userId = req.user.id; 
    let movies = await db.query("SELECT DISTINCT movieName, myListMovie_id FROM myList WHERE movieId = $1", [userId]);
    res.render("mylist", { allMovie: movies.rows });
});

app.post("/deleteMoviefromMylist", async (req, res) => {
    let movieId = req.query.movieID;
    await db.query("DELETE FROM myList WHERE myListMovie_id = ($1)", [movieId]);
    res.redirect("/myList");
});

passport.use(new Strategy(async function verify(username, password, cb) {
    try {
        const result = await db.query(`SELECT * FROM user_info WHERE email = ($1)`, [username]);

        if (result.rows.length === 0) {
            console.log("User is not registered");
            return cb(null, false);
        } else {
            const user = result.rows[0];
            const hashedPassword = user.password;

            bcrypt.compare(password, hashedPassword, (err, passwordMatch) => {
                if (err) {
                    console.error("Error comparing passwords:", err);
                    return cb(err);
                } else {
                    if (passwordMatch) {
                        return cb(null, user); 
                    } else {
                        console.log("Incorrect password");
                        return cb(null, false);
                    }
                }
            });
        }
    } catch (error) {
        console.error("Error fetching user data:", error);
        return cb(error);
    }
}));

passport.use("google", new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL,
    userProfileURL: "https://www.googleapis.com/oauth2/v3/userinfo"
}, async (accessToken, refreshToken, profile, cb) => {
    let result = await db.query("select * from user_info where email = ($1)", [profile.email]); 
    if (result.rows.length === 0) {
        await db.query("insert into user_info (email, password) values ($1, $2)", [profile.email, "google"]);
        return cb(null, result.rows[0]);
    } else {
        cb(null, result.rows[0]);
    }
}));

passport.serializeUser((user, cb) => {
    cb(null, user);
});

passport.deserializeUser((user, cb) => {
    cb(null, user);
});

app.listen(port, () => {
    console.log("live on server 3000");
});
