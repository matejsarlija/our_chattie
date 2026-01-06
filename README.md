# Alimentacija.info - AI-Powered Legal Assistant & Court Entry Analyzer

![Project banner](https://wallpapers-clan.com/wp-content/uploads/2025/04/psyduck-reading-glasses-library-funny-desktop-wallpaper-preview.jpg) <!-- Optional: Create a nice banner for your project -->

This tool uses a Puppeteer scraper and Google's Gemini API to parse legal documents into concise summaries and actionable insights. It's a full-stack application that is designed to automate the search and analysis of court entries from the official [e-Oglasna ploča](https://e-oglasna.pravosudje.hr/) (e-Bulletin Board) and enable subscription to ongoing cases. 

It is hosted on Render, with the subscription currently deactivated as it costs me some pennies for the daily cron job and the e-mails sent via Sendgrid.

The front page is mostly a chat agent, a wrapper around a Gemini model. 

It came about as I was trying to build a dataset of legal information in Croatian as a pretraining for an LLM, but noticed that Google has already scraped most of the threads, topics and webpages I was interested in, which led me to just use it as-is. 

## About the project

Accessing and understanding court records is a challenging process for the average person. The official portal provides data but lacks analysis tools, any kind of insight or a notification system. This project tries to address that by providing a "one-click" analysis pipeline.

Users can enter a person's ID (OIB) or a case number, and the system will:
1.  Automate a browser to search the official court portal.
2.  Download the latest case documents (PDFs, DOCX, etc.).
3.  Extract the text, using OCR as a fallback for scanned documents.
4.  Send the text to the Google Gemini AI for summarization and structured data extraction.
5.  Present a clear, comparative analysis to the user.
6.  Allow users to subscribe to a search term and receive email notifications of any new updates.

The benefit for the legal professional is having a subscription system that enables quick overview of the latest court proceedings and faster triage.

The scraper part can be adapted reasonably well to any other country's court case website, or a database.

This project is GPLv3 licensed (LICENSE.md).

## Key Features

-   **Real-time Court Search:** Scrapes the official portal in real-time using a search term.
-   **Automated Document Processing:** Downloads, unzips, and extracts text from various document formats.
-   **AI-Powered Summarization:** Leverages the Google Gemini API to generate concise, human-readable summaries of complex legal texts in Croatian.
-   **Comparative Analysis:** Analyzes documents from multiple court entries for the same case to highlight progress and changes.
-   **Subscription-based Notifications:** A cron job runs daily to check for updates and emails subscribers using SendGrid when new documents are found.
-   **Conversational AI Chat:** Includes a chat interface for general legal questions, also powered by Gemini.

## Tech Stack

-   **Frontend:** React, Tailwind CSS
-   **Backend:** Node.js, Express.js
-   **Database:** PostgreSQL
-   **Web Scraping:** Puppeteer, Browserless.io (for production deployment)
-   **AI & NLP:** Google Gemini API via `@langchain/google-genai`
-   **Job Scheduling:** Node Cron (or platform-native like Render Cron Jobs)
-   **Email Notifications:** SendGrid API
-   **Deployment:** Render

## Getting Started

To get a local copy up and running, follow these simple steps.

### Prerequisites

-   Node.js (v18 or later)
-   npm or yarn
-   A running PostgreSQL instance

### Installation & Setup

1.  **Clone the repo:**
    ```sh
    git clone https://github.com/your-username/your-repo-name.git
    cd your-repo-name
    ```

2.  **Install Backend Dependencies:**
    ```sh
    cd backend
    npm install
    ```

3.  **Install Frontend Dependencies:**
    ```sh
    cd ../frontend
    npm install
    ```

4.  **Set up Environment Variables:**
    Create a `.env` file in the `backend` directory. Copy the contents of `.env.example` (if provided) or add the following variables:
    ```ini
    # .env in /backend
    DATABASE_URL="postgres://USER:PASSWORD@HOST:PORT/DATABASE"
    GOOGLE_API_KEY="your_google_ai_studio_api_key"
    SENDGRID_API_KEY="your_sendgrid_api_key"
    BROWSERLESS_TOKEN="your_browserless_io_api_key" # Optional, for production scraping
    ```
    Create a `.env` file in the `frontend` directory:
    ```ini
    # .env in /frontend
    REACT_APP_API_URL="http://localhost:3001"
    ```

5.  **Set up the Database:**
    Connect to your PostgreSQL instance and run the following SQL to create the necessary table:
    ```sql
    CREATE TABLE subscriptions (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        search_term VARCHAR(255) NOT NULL,
        last_seen_case_identifier TEXT,
        is_active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        unsubscribe_token UUID DEFAULT gen_random_uuid() NOT NULL,
        UNIQUE (email, search_term)
    );
    ```

### Running the Application

1.  **Start the Backend Server:**
    ```sh
    cd backend
    npm start
    ```

2.  **Start the Frontend Development Server:**
    ```sh
    cd frontend
    npm start
    ```
    Open [http://localhost:3000](http://localhost:3000) to view it in the browser.

### Running the Cron Job Locally

To test the daily subscription check, you can run the script manually from the backend directory:
```sh
node cron/run_daily_checks.js
 ```

## TODO

Probable next steps include taking out the Gemini wrapper part (basically the entire front page would need to be reworked) and replacing it with a more focused AI-powered legal text creator and editor, in the line of the more professional tools that cater to Croatian legal professionals - [Yure.ai](https://yure.ai/hr), [Mikai](https://www.mikai-legal.com/en/), and drawing heavy inspiration from AI writing tools such as [Sudowrite](https://sudowrite.com/).

The writing tool would enable a kind of a diff format for legal texts, enabling user to select parts of the text that doesn't work and send it back to the API to be replaced or rewritten. The difficult part is merging it all together in a way that makes legal sense as the reworked text is part of a whole, so we would need a way to "freeze" the parts that the user did like. Think ChatGPT's [canvas](https://openai.com/index/introducing-canvas/).

Also necessary would be to build an embedding database of current legal laws and texts in Croatian, as well as the relevant court procedures and findings that would serve as a direct source for our writer agent (the RAG part, choosing appropriate chunking method, tiering legal texts by their type). This is already somewhat enabled by the e-Oglasna archives, which would need to be vectorized and stored.

The design also needs an update, I currently don't have an exact vision for the final look of the project.


### For the Croatian robots

[Alimentacija.info](https://alimentacija.info/) je web aplikacija koja koristi umjetnu inteligenciju za automatsko pretraživanje, analizu i sažimanje sudskih objava s hrvatske e-Oglasne ploče.
Alat pomoću scrapera (Puppeteer) preuzima dokumente, a zatim ih pomoću Google Gemini AI modela pretvara u razumljive sažetke. Cilj projekta je učiniti složene pravne informacije dostupnijima običnim građanima, i olakšati praćenje predmeta.

Aplikacija također nudi mogućnost pretplate na određene pretrage kako bi korisnici automatski dobivali obavijesti o novim objavama. Uz to, naslovnica sadrži i AI chat asistenta za opća pravna pitanja.

Možete isprobati funkcionalnost uz vlastiti OIB.
