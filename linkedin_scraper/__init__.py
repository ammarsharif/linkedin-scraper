"""LinkedIn Scraper - Async Playwright-based scraper for LinkedIn."""

# Version
__version__ = "3.2.0"

# Core modules
from .core import (
    BrowserManager,
    login_with_credentials,
    login_with_cookie,
    is_logged_in,
    wait_for_manual_login,
    load_credentials_from_env,
    # Exceptions
    LinkedInScraperException,
    AuthenticationError,
    RateLimitError,
    ElementNotFoundError,
    ProfileNotFoundError,
    NetworkError,
    ScrapingError,
)

# Scrapers
from .scrapers import (
    PersonScraper,
    CompanyScraper,
    JobScraper,
    JobSearchScraper,
    CompanyPostsScraper,
    PersonPostsScraper,
)

# Callbacks
from .callbacks import (
    ProgressCallback,
    ConsoleCallback,
    SilentCallback,
    JSONLogCallback,
    MultiCallback,
)

# Models
from .models import (
    Person,
    Experience,
    Education,
    Contact,
    Accomplishment,
    Interest,
    Company,
    CompanySummary,
    Employee,
    Job,
    Post,
)

# Export utilities
from .export import (
    export_posts_to_csv,
    export_posts_to_json,
    export_batch_results_to_csv,
)

__all__ = [
    # Version
    "__version__",
    # Core
    "BrowserManager",
    "login_with_credentials",
    "login_with_cookie",
    "is_logged_in",
    "wait_for_manual_login",
    "load_credentials_from_env",
    # Scrapers
    "PersonScraper",
    "CompanyScraper",
    "JobScraper",
    "JobSearchScraper",
    "CompanyPostsScraper",
    "PersonPostsScraper",
    # Exceptions
    "LinkedInScraperException",
    "AuthenticationError",
    "RateLimitError",
    "ElementNotFoundError",
    "ProfileNotFoundError",
    "NetworkError",
    "ScrapingError",
    # Callbacks
    "ProgressCallback",
    "ConsoleCallback",
    "SilentCallback",
    "JSONLogCallback",
    "MultiCallback",
    # Models
    "Person",
    "Experience",
    "Education",
    "Contact",
    "Accomplishment",
    "Interest",
    "Company",
    "CompanySummary",
    "Employee",
    "Job",
    "Post",
    # Export
    "export_posts_to_csv",
    "export_posts_to_json",
    "export_batch_results_to_csv",
]
