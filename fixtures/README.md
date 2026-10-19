# Fixtures

- `portion-cat1.txt` and `portion-cat2.txt`: Modules 3 to 5 and Modules 6 to 7 of the BCSE101E Computer Programming: Python syllabus, copied verbatim (typos included) from the public course page at https://github.com/durgeshbhagat/Computer_Programming_Python_BCSE101E.
- `ground-truth.json`: which sections of the sample book a student should read for each syllabus line. Labelled by hand from the book's table of contents and a text search of the PDF, before the model was run. Each chapter's summary section was added as "acceptable" after the first run.

The sample book is *Introduction to Python Programming* by OpenStax (2024), free at https://openstax.org/details/books/introduction-python-programming. It is not committed. `npm run embed:book` downloads it into `.cache/`.

The two portions are used differently. `cat1` was used to pick the matching settings (`npm run eval -- --sweep`). `cat2` was not used for tuning and is the held-out check. The "probably not in this book" threshold (`minLift`) was chosen after looking at scores from both portions, so the not-in-book results are a fit, not a test.
