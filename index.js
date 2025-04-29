require("dotenv").config();
const express = require("express");
const axios = require("axios");
const cors = require("cors");
const app = express();
const chrono = require("chrono-node");

app.use(express.json());
app.use(cors());

const API_KEY = process.env.API_KEY;
const CURRENT_WEATHER_URL = "https://api.openweathermap.org/data/2.5/weather";
const FORECAST_WEATHER_URL = "https://api.openweathermap.org/data/2.5/forecast";

async function getCityCoordinates(city) {
  try {
    const geoUrl = `http://api.openweathermap.org/geo/1.0/direct?q=${city}&limit=1&appid=${API_KEY}`;
    const response = await axios.get(geoUrl);

    if (response.data && response.data.length > 0) {
      const { lat, lon } = response.data[0];
      return { lat, lon };
    } else {
      throw new Error(`Could not find coordinates for ${city}`);
    }
  } catch (error) {
    console.error("Error getting city coordinates:", error.message);
    throw error;
  }
}

async function getCurrentWeather(city) {
  try {
    const coords = await getCityCoordinates(city);
    const url = `${CURRENT_WEATHER_URL}?lat=${coords.lat}&lon=${coords.lon}&units=metric&appid=${API_KEY}`;
    const response = await axios.get(url);

    return {
      city: city,
      temperature: response.data.main.temp,
      feels_like: response.data.main.feels_like,
      description: response.data.weather[0].description,
      humidity: response.data.main.humidity,
      wind_speed: response.data.wind.speed,
      icon: response.data.weather[0].icon,
    };
  } catch (error) {
    console.error("Error getting current weather:", error.message);
    throw error;
  }
}
async function getMultiDayForecast(city, days) {
  if (days < 1 || days > 5) {
    throw new Error("Forecast available only for up to 5 days.");
  }

  const { lat, lon } = await getCityCoordinates(city);
  const url = `${FORECAST_WEATHER_URL}?lat=${lat}&lon=${lon}&units=metric&appid=${API_KEY}`;
  const response = await axios.get(url);

  const forecasts = response.data.list;

  const forecastMap = {};

  forecasts.forEach((item) => {
    const date = item.dt_txt.split(" ")[0];
    if (!forecastMap[date]) {
      forecastMap[date] = [];
    }
    forecastMap[date].push(item);
  });

  const result = [];

  const forecastDates = Object.keys(forecastMap).slice(0, days);

  forecastDates.forEach((date) => {
    const dayItems = forecastMap[date];
    const temps = dayItems.map((f) => f.main.temp);
    const humidities = dayItems.map((f) => f.main.humidity);
    const windSpeeds = dayItems.map((f) => f.wind.speed);
    const descriptions = dayItems.map((f) => f.weather[0].description);
    const icons = dayItems.map((f) => f.weather[0].icon);

    const avg = (arr) =>
      (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
    const mostCommon = (arr) =>
      arr
        .sort(
          (a, b) =>
            arr.filter((v) => v === a).length -
            arr.filter((v) => v === b).length
        )
        .pop();

    result.push({
      date,
      temp_min: Math.min(...temps).toFixed(1),
      temp_max: Math.max(...temps).toFixed(1),
      description: mostCommon(descriptions),
      humidity: avg(humidities),
      wind_speed: avg(windSpeeds),
      icon: mostCommon(icons),
    });
  });

  return result;
}

async function getForecastWeather(city, targetDate) {
  try {
    const coords = await getCityCoordinates(city);
    const url = `${FORECAST_WEATHER_URL}?lat=${coords.lat}&lon=${coords.lon}&units=metric&appid=${API_KEY}`;
    const response = await axios.get(url);

    const forecasts = response.data.list;

    // Filter forecasts for the same date
    const targetDay = targetDate.toISOString().split("T")[0];
    const dailyForecasts = forecasts.filter((item) =>
      item.dt_txt.startsWith(targetDay)
    );

    if (dailyForecasts.length === 0) {
      throw new Error("No forecast data available for that date.");
    }

    // Aggregate values (average temp, etc.)
    const temps = dailyForecasts.map((f) => f.main.temp);
    const descriptions = dailyForecasts.map((f) => f.weather[0].description);
    const humidities = dailyForecasts.map((f) => f.main.humidity);
    const windSpeeds = dailyForecasts.map((f) => f.wind.speed);
    const icons = dailyForecasts.map((f) => f.weather[0].icon);

    const avg = (arr) =>
      (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1);
    const mostCommon = (arr) =>
      arr
        .sort(
          (a, b) =>
            arr.filter((v) => v === a).length -
            arr.filter((v) => v === b).length
        )
        .pop();

    return {
      city: city,
      date: targetDate.toDateString(),
      temp_min: Math.min(...temps).toFixed(1),
      temp_max: Math.max(...temps).toFixed(1),
      description: mostCommon(descriptions),
      humidity: avg(humidities),
      wind_speed: avg(windSpeeds),
      icon: mostCommon(icons),
    };
  } catch (error) {
    console.error("Error getting forecast:", error.message);
    throw error;
  }
}

app.post("/webhook", async (req, res) => {
  try {
    console.log("Received webhook request:", JSON.stringify(req.body));

    const queryResult = req.body.queryResult;

    let city =
      queryResult.parameters["geo-city"] ||
      queryResult.parameters["pakistan-city"] ||
      "";
    city = city.trim();

    if (!city) {
      return res.json({
        fulfillmentText: "Please provide a valid city name.",
      });
    }

    const intentName = queryResult.intent.displayName;
    let response;

    if (intentName === "Current Weather Intent") {
      const weatherData = await getCurrentWeather(city);
      response = {
        fulfillmentText: `Current weather in ${weatherData.city}: ${weatherData.temperature}°C, ${weatherData.description}. Humidity: ${weatherData.humidity}%, Wind: ${weatherData.wind_speed} m/s.`,
      };
    } else if (intentName === "Weather Forecast Intent") {
      const dateParam = queryResult.parameters["date-time"];
      const parsedDate = dateParam ? chrono.parseDate(dateParam) : new Date();

      const forecastData = await getForecastWeather(city, parsedDate);
      response = {
        fulfillmentText: `Forecast for ${forecastData.city} on ${forecastData.date}: Temperature between ${forecastData.temp_min}°C and ${forecastData.temp_max}°C. ${forecastData.description}. Humidity: ${forecastData.humidity}%, Wind: ${forecastData.wind_speed} m/s.`,
      };
    } else if (intentName === "Multi Day Forecast Intent") {
      const datePeriod = queryResult.parameters["date-period"];
      let numDays = queryResult.parameters["number"];

      if (!numDays && datePeriod?.startDate && datePeriod?.endDate) {
        const start = new Date(datePeriod.startDate);
        const end = new Date(datePeriod.endDate);
        const msPerDay = 1000 * 60 * 60 * 24;
        numDays = Math.ceil((end - start) / msPerDay) + 1;
      }

      if (!numDays || isNaN(numDays)) numDays = 3;
      if (numDays > 5) {
        return res.json({
          fulfillmentText:
            "Sorry, I can only provide forecasts for up to 5 days.",
        });
      }

      const forecasts = await getMultiDayForecast(city, numDays);

      const forecastText = forecasts
        .map(
          (f) =>
            `${f.date}: ${f.description}, temp between ${f.temp_min}°C and ${f.temp_max}°C. Humidity: ${f.humidity}%, Wind: ${f.wind_speed} m/s.`
        )
        .join("\n");

      response = {
        fulfillmentText: `Here's the ${numDays}-day forecast for ${city}:\n${forecastText}`,
      };
    } else {
      response = {
        fulfillmentText:
          "I can help you with current weather or weather forecasts. Please specify a city.",
      };
    }

    console.log("Sending response:", JSON.stringify(response));
    return res.json(response);
  } catch (error) {
    console.error("Error processing webhook:", error);
    return res.json({
      fulfillmentText: `Sorry, there was an error processing your request: ${error.message}`,
    });
  }
});

app.get("/", (req, res) => {
  res.send("Weather Webhook Service is running!");
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
