import pandas as pd

# Create a DataFrame from a dictionary
data = {
    'Name': ['Alice', 'Bob', 'Charlie'],
    'Age': [25, 30, 35],
    'City': ['New York', 'Paris', 'London']
}
df = pd.DataFrame(data)
print("DataFrame:\n", df)

# Select a column
print("\nAges:\n", df['Age'])

# Filter rows
print("\nPeople older than 28:\n", df[df['Age'] > 28])

# Add a new column
df['Senior'] = df['Age'] > 30
print("\nDataFrame with 'Senior' column:\n", df)

# Group by a column and get mean age
print("\nMean age by city:\n", df.groupby('City')['Age'].mean())