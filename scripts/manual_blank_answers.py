"""按 (qid, new_blank_index) 显式给出答案，覆盖 regen 脚本的自动匹配。

new_blank_index 指 regen 后 code_segments 里 type=='blank' 的零基索引，
按出现顺序计数（与 dry-run warning 中 'new blank #N' 一致）。

每条 answer 与 .ipynb 中对应的 _____ 行结构对齐：
- 单行模板 → 单行 answer，已包含模板的缩进；
- 多行模板 → 多行 answer，每行均按模板的前导缩进对齐。
"""

# (qid, new_blank_index) -> answer string
MANUAL_ANSWERS: dict[tuple[int, int], str] = {
    # ── q2 1.1.2 sensor_data ────────────────────────────────────────────
    (2, 1): "sensor_stats = data.groupby('SensorType')['Value'].agg(['count', 'mean'])",
    (2, 2): (
        "location_stats = data[data['SensorType'].isin(['Temperature', 'Humidity'])]"
        ".groupby(['Location', 'SensorType'])['Value'].mean().unstack()"
    ),
    (2, 3): (
        "data['is_abnormal'] = np.where(((data['SensorType'] == 'Temperature') & "
        "((data['Value'] < -10) | (data['Value'] > 50))) | "
        "((data['SensorType'] == 'Humidity') & ((data['Value'] < 0) | "
        "(data['Value'] > 100))), True, False)"
    ),
    (2, 4): "print(\"异常值数量:\", data['is_abnormal'].sum())",
    (2, 5): (
        "data['Value'].fillna(method='ffill', inplace=True)\n"
        "data['Value'].fillna(method='bfill', inplace=True)"
    ),
    (2, 6): (
        "cleaned_data = data.drop(columns=['is_abnormal'])\n"
        "cleaned_data.to_csv('cleaned_sensor_data.csv', index=False)"
    ),

    # ── q3 1.1.3 credit_data ────────────────────────────────────────────
    (3, 2): "cleaned_data.to_csv('cleaned_credit_data.csv', index=False)",

    # ── q4 1.1.4 user_behavior ──────────────────────────────────────────
    (4, 5): "            (data['ReviewScore'].between(1, 5))]",
    (4, 10): "data['AgeGroup'] = pandas.cut(data['Age'], bins=bins, labels=labels, right=False)",

    # ── q5 1.1.5 vehicle_traffic ────────────────────────────────────────
    (5, 4): (
        "data = data[(data['Age'].between(18, 70)) & (data['Speed'].between(0, 200)) & "
        "(data['TravelDistance'].between(1, 1000)) & (data['TravelTime'].between(1, 1440))]"
    ),
    (5, 5): "data.to_csv('cleaned_vehicle_traffic_data.csv', index=False)",
    (5, 6): (
        "unreasonable_data = data[~((data['Age'].between(18, 70)) & "
        "(data['Speed'].between(0, 200)) & (data['TravelDistance'].between(1, 1000)) & "
        "(data['TravelTime'].between(1, 1440)))]"
    ),
    (5, 7): "traffic_event_counts = data['TrafficEvent'].value_counts()",
    (5, 8): "gender_stats = data.groupby('Gender').agg({'Speed': 'mean', 'TravelDistance': 'mean', 'TravelTime': 'mean'})",
    (5, 9): (
        "data['AgeGroup'] = pd.cut(data['Age'], age_bins, age_labels, right=False)\n"
        "age_group_counts = data['AgeGroup'].value_counts().sort_index()"
    ),

    # ── q11 2.1.1 auto-mpg ──────────────────────────────────────────────
    (11, 1): "print(data.head())",
    (11, 2): "print(data.isnull().sum())  \ndata = data.dropna()",
    (11, 4): "data[numerical_features] = scaler.fit_transform(data[numerical_features])",
    (11, 6): "X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)",

    # ── q12 2.1.2 低碳数据集 ────────────────────────────────────────────
    (12, 0): "data = pd.read_excel('大学生低碳生活行为的影响因素数据集.xlsx')",
    (12, 1): (
        "initial_row_count = data.shape[0]\n"
        "data = data.dropna()\n"
        "final_row_count = data.shape[0]"
    ),
    (12, 2): "data = data.drop_duplicates()",
    (12, 3): "data[numerical_features] = scaler.fit_transform(data[numerical_features])",
    (12, 4): (
        "selected_features = ['1 ．您的性别 o男性 o女性', '2 ．您的年级 o大一 o大二 o大三 o大四', "
        "'3 ．您的生源地 o农村 o城镇(乡镇) o地县级城市 o省会城市及直辖市', "
        "'4.您的月生活费○≦1,000元   ○1,001-2,000元   ○2,001-3,000元   ○≧3,001元', "
        "'6 ．您觉得低碳与你的生活关系密切吗？', '7 ．低碳生活是否会成为未来的主流生活方式？', "
        "'8 ．您是否认为低碳生活会提高您的生活质量？']\n"
        "X = data[selected_features]"
    ),
    (12, 6): "X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)",
    (12, 7): (
        "cleaned_data = pd.concat([X, y], axis=1)\n"
        "cleaned_data.to_csv('2.1.2_cleaned_data.csv', index=False)"
    ),

    # ── q13 2.1.3 finance ───────────────────────────────────────────────
    (13, 1): "data.head()",
    (13, 5): "data_cleaned[numeric_cols] = scaler.fit_transform(data_cleaned[numeric_cols])",
    (13, 9): "data_cleaned.to_csv(cleaned_file_path, index=False)",

    # ── q14 2.1.4 medical_data ──────────────────────────────────────────
    (14, 1): "print(data.info())",
    (14, 5): "data.drop_duplicates(inplace=True)",
    (14, 6): (
        "columns_to_normalize = ['诊断延迟', '病程']\n"
        "data[columns_to_normalize] = scaler.fit_transform(data[columns_to_normalize])"
    ),
    (14, 9): "data.to_csv(output_path, index=False)",

    # ── q15 2.1.5 健康咨询 ──────────────────────────────────────────────
    (15, 1): "print(data.info())",
    (15, 2): "print(data.isnull().sum())",
    (15, 5): "data_cleaned.loc[:, 'Your age'] = data_cleaned['Your age'].astype(int)",
    (15, 6): "data_cleaned = data_cleaned.drop_duplicates()",
    (15, 7): (
        "data_cleaned['How do you describe your current level of fitness ?'] = "
        "label_encoder.fit_transform(data_cleaned['How do you describe your current level of fitness ?'])"
    ),
    (15, 8): "plt.pie(exercise_frequency_counts, labels=exercise_frequency_counts.index, autopct='%1.1f%%', startangle=90, colors=plt.cm.Paired.colors)",
    (15, 9): "train_data, test_data = train_test_split(data_filled, test_size=0.2, random_state=42)",

    # ── q16 2.2.1 finance ───────────────────────────────────────────────
    (16, 1): "print(data.head())",
    (16, 3): "model = LogisticRegression(max_iter=1000)",
    (16, 5): "    pickle.dump(model, file)",
    (16, 7): "accuracy = model.score(X_test, y_test)",
    (16, 8): "X_resampled, y_resampled = smote.fit_resample(X_train, y_train)",

    # ── q17 2.2.2 auto-mpg ──────────────────────────────────────────────
    (17, 1): "print(df.head())",
    (17, 8): "    pickle.dump(pipeline, model_file)",
    (17, 10): "results_df.to_csv('2.2.2_results.txt', index=False)",
    (17, 11): "rf_model = RandomForestRegressor(n_estimators=100, random_state=42)",
    (17, 14): "results_rf_df.to_csv('2.2.2_results_rf.txt', index=False)",

    # ── q18 2.2.3 fitness analysis ──────────────────────────────────────
    (18, 1): "print(df.head())",
    (18, 2): "X = pd.get_dummies(X)  # 将分类变量转为数值变量",
    (18, 5): "rf_model = RandomForestRegressor(n_estimators=100, random_state=42)",
    (18, 7): "    pickle.dump(rf_model, model_file)",
    (18, 8): "y_pred = rf_model.predict(X_test)",
    (18, 13): (
        "    xgb_report_file.write(f'XGBoost训练集得分: {xgb_model.score(X_train, y_train)}\\n')\n"
        "    xgb_report_file.write(f'XGBoost测试集得分: {xgb_model.score(X_test, y_test)}\\n')\n"
        "    xgb_report_file.write(f'XGBoost均方误差(MSE): {mean_squared_error(y_test, y_pred_xgb)}\\n')\n"
        "    xgb_report_file.write(f'XGBoost决定系数(R^2): {r2_score(y_test, y_pred_xgb)}\\n')"
    ),

    # ── q19 2.2.4 低碳数据集 ────────────────────────────────────────────
    (19, 1): "print(data.head())",
    (19, 7): "joblib.dump(model, model_filename)",
    (19, 9): "results.to_csv(results_filename, index=False, sep='\\t')  # 使用制表符分隔值保存到文本文件",
    (19, 10): (
        "    f.write(f'均方误差: {mean_squared_error(y_test, y_pred)}\\n')\n"
        "    f.write(f'决定系数: {r2_score(y_test, y_pred)}\\n')"
    ),
    (19, 11): "xgb_model = XGBRegressor(n_estimators=1000, learning_rate=0.05, max_depth=5, subsample=0.8, colsample_bytree=0.8)",
    (19, 14): (
        "    f.write(f'均方误差: {mean_squared_error(y_test, y_pred_xg)}\\n')\n"
        "    f.write(f'决定系数: {r2_score(y_test, y_pred_xg)}\\n')"
    ),

    # ── q20 2.2.5 fitness analysis ──────────────────────────────────────
    (20, 1): "print(df.head())",
    (20, 2): "X = pd.get_dummies(X)  # 将分类变量转为数值变量",
    (20, 7): "    pickle.dump(model, model_file)",
    (20, 9): "results.to_csv(results_filename, index=False, sep='\\t')  ",
    (20, 10): (
        "with open(report_filename, 'w') as f:\n"
        "    f.write(f'均方误差: {mean_squared_error(y_test, y_pred)}\\n')\n"
        "    f.write(f'平均绝对误差: {mean_absolute_error(y_test, y_pred)}\\n')\n"
        "    f.write(f'决定系数: {r2_score(y_test, y_pred)}\\n')"
    ),

    # ── q30 (already partially patched) ────────────────────────────────
    (30, 3): "    os.makedirs(result_path)",
}
