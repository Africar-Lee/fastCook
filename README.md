# FastCook 极速厨

FastCook 根据家里已有的食材，帮你决定今天做什么、还需要买什么，以及一顿饭怎么搭配，支持 Android 和 Web。

FastCook helps you decide what to cook, what else to buy, and how to put a meal together using the ingredients you already have. It supports Android and Web.

比如冰箱里还剩番茄和鸡蛋，家里有油、盐和炒锅，就可以在 FastCook 中选好这些食材，查看番茄炒鸡蛋的做法，再搭配其他菜组成一顿饭。

For example, if you have tomatoes and eggs in the fridge, plus cooking oil, salt, and a wok, select those ingredients in FastCook to find instructions for stir-fried tomatoes and eggs, then add other dishes to complete your meal.

## 下载 / Download

Android 安装包可在 [GitHub Releases](https://github.com/Africar-Lee/fastCook/releases) 下载。进入对应版本，在 Assets 中选择 `.apk` 文件并安装到手机。

Android installation packages are available from [GitHub Releases](https://github.com/Africar-Lee/fastCook/releases). Open a release, download the `.apk` file under Assets, and install it on your phone.

## 开始使用 / Getting Started

第一次打开时，先在「调料柜」记录常备调料，再到「设置」选择家里有的厨具。回到「今天做什么」，添加这次准备使用的食材，就能查看推荐菜谱。选中一道菜后可以查看做法，或点击「帮我配一顿」获取整顿饭的搭配建议。

On your first visit, record your pantry staples in the pantry tab, then select your available cookware in settings. Return to the recipe recommendations screen and add the ingredients you want to use. Open a recipe to read the instructions, or use the meal planning button to get suggestions for a complete meal.

## 主要功能 / Features

### 食材推荐与配餐 / Recipe Recommendations and Meal Planning

根据这次要用的食材、常备调料和家里的厨具，查看能做哪些菜、缺少什么，以及是否有合适的食材替代。可以按耗时、辣度和菜品类别筛选，也可以看看再买一种食材能多做哪些菜。

See what you can cook with your selected ingredients, pantry staples, and cookware, along with anything missing and suitable ingredient substitutions. Filter recipes by cooking time, spiciness, and dish category, or see which extra dishes you could make by buying one more ingredient.

可以把多道菜加入同一顿饭，按用餐人数获取搭配建议，替换其中的菜品，并结合灶眼数量估算制作时间。多道菜共用同一种食材时，应用会提示确认是否够用。

Add several dishes to a meal, get suggestions based on the number of people, replace individual dishes, and estimate preparation time based on the number of available burners. When multiple dishes use the same ingredient, the app asks you to confirm that you have enough.

### 私人菜谱与图片 / Personal Recipes and Photos

把自己的拿手菜记录下来，填写食材用量、做法、厨具、耗时和适用人数。保存的私人菜谱也会出现在食材推荐和配餐中。

Save your own favorite recipes with ingredient quantities, instructions, cookware, cooking time, and servings. Your personal recipes will also appear in ingredient-based recommendations and meal planning.

可以为菜谱添加成品图片和步骤图片，设置封面，方便记录自己的做法。私人菜谱支持文件导入、导出和分享；内容长度符合要求的无图片菜谱可以生成二维码，由 Android 应用扫码导入。带图片的菜谱通过文件分享，Web 端通过文件导入。

Add photos of the finished dish and individual steps, and choose a cover image to document your recipes. Personal recipes can be imported, exported, and shared as files. Recipes without images that fit within the content size limit can also be shared as QR codes and imported by scanning them in the Android app. Recipes with images are shared as files, and the Web app supports file import.

### 拍照识别食材 / Ingredient Recognition from Photos

拍下食材或从相册选一张照片，让 AI 帮你识别。确认或修正识别结果后，就能将食材加入列表。

Take a photo of your ingredients or choose one from your gallery and let AI help identify them. Review or correct the results, then add the ingredients to your list.

拍照识别需要自备 AI 服务的 API Key，在「设置」中的「识别模型」填写服务地址、模型名称和密钥后即可使用。每次识别都由你确认发送图片，相关费用由所选服务商收取。你还可以设置每日调用次数，并查看识别记录。

Photo recognition requires your own API key from an AI service. Configure the service address, model name, and key in the recognition model settings. You confirm each image before it is sent, and any usage charges come from your selected provider. You can also set a daily request limit and view recognition history.

### 保存记录与个性设置 / Saved Data and Preferences

食材、调料柜、私人菜谱、配餐选择和厨房设置保存在你的设备上，下次打开可以继续使用。在「设置」中的「备份与恢复」可以导出备份文件，也可以从文件恢复记录。

Your ingredients, pantry staples, personal recipes, meal selections, and kitchen settings are saved on your device for your next visit. Use backup and restore in settings to export a backup file or restore your saved data from a file.

界面提供简体中文与英文切换，并适配系统浅色和深色主题。

The interface supports Simplified Chinese and English and follows the system's light or dark theme.

## 后续更新计划 / Planned Updates

以下功能列入更新计划，具体上线时间将随开发进展确定。

The following features are planned. Release timing will be determined as development progresses.

### 共享菜谱库 / Community Recipe Library

计划提供在线共享菜谱库，让你上传自己的拿手菜，也能浏览和获取其他用户分享的菜谱，发现更多适合日常做饭的新选择。

An online community recipe library is planned, where you can upload your own favorite dishes and browse or get recipes shared by other users to discover more ideas for everyday cooking.

### 每道菜谱的用户评论区 / Comments on Each Recipe

为菜谱提供独立评论区，让用户围绕具体做法交流。例如做完一道菜后，可以记录调整过的用量、实际烹饪时间和遇到的问题，也可以询问某个步骤的操作细节，给其他使用者提供参考。

Add a dedicated comment section to each recipe so users can discuss how to prepare it. After cooking a dish, users could share adjusted quantities, actual cooking times, and problems they encountered, or ask about a particular step to help others using the recipe.

### 菜谱视频上传 / Recipe Video Uploads

支持为菜谱上传和播放烹饪视频，并将视频与对应菜谱或操作步骤关联。通过视频展示切配、翻炒、火候和成品状态，帮助用户理解文字和图片较难表达的操作过程。

Support uploading and playing cooking videos linked to a recipe or an individual step. Videos will demonstrate ingredient preparation, stir-frying, heat control, and the finished dish, helping explain techniques that are harder to convey through text and photos.

